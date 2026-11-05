import { createHash } from "node:crypto";
import { z } from "zod/v4";

/**
 * Where the AI agent's model runs, and how Cuework talks to it. Two kinds of provider:
 *
 *  - Ollama: a free, open-weight model running on a machine you control (the default).
 *  - A hosted provider's free tier, through its OpenAI-compatible API (Groq or Gemini presets,
 *    or any compatible endpoint). Free within the provider's rate limits, but the data leaves
 *    your infrastructure and free tiers may use it, so by default hosted models only ever see
 *    the fictional demo workspace. Real workspaces use Ollama or the rules engine, unless
 *    CUEWORK_AI_HOSTED_FOR_ALL=true.
 *
 * Every request is short and its reply is constrained to a fixed JSON schema, which is what keeps
 * small models reliable; replies are re-validated here regardless of provider.
 */

export const DEFAULT_OLLAMA_MODEL = "qwen3:4b";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/** Hosted presets. Model ids change often; override with AI_MODEL. */
export const HOSTED_PRESETS = {
  groq: { url: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", keyEnv: "GROQ_API_KEY" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", keyEnv: "GEMINI_API_KEY" },
} as const;
export type HostedProvider = keyof typeof HOSTED_PRESETS | "openai-compatible";

export type ModelConfig =
  | { kind: "ollama"; url: string; model: string }
  | { kind: "hosted"; provider: HostedProvider; url: string; model: string; apiKey: string };

type Env = Record<string, string | undefined>;
const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

export function ollamaConfig(env: Env = process.env): ModelConfig {
  return { kind: "ollama", url: trimUrl(env.OLLAMA_URL || DEFAULT_OLLAMA_URL), model: env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL };
}

/** The hosted provider configured in the environment, if any (needs CUEWORK_AI_PROVIDER and a key). */
export function hostedConfig(env: Env = process.env): ModelConfig | null {
  const provider = env.CUEWORK_AI_PROVIDER?.trim().toLowerCase() as HostedProvider | undefined;
  if (!provider || provider === ("ollama" as HostedProvider)) return null;
  const preset = provider in HOSTED_PRESETS ? HOSTED_PRESETS[provider as keyof typeof HOSTED_PRESETS] : null;
  const apiKey = (env.AI_API_KEY || (preset ? env[preset.keyEnv] : undefined) || "").trim();
  const url = trimUrl(env.AI_BASE_URL || preset?.url || "");
  const model = env.AI_MODEL?.trim() || preset?.model || "";
  if (!apiKey || !url || !model) return null;
  return { kind: "hosted", provider, url, model, apiKey };
}

export type Availability = { ok: true; config: ModelConfig } | { ok: false; reason: string; configured: boolean };

/**
 * Which model the agent should use for a workspace right now, if any.
 * `configured: false` means no AI is set up here (e.g. production without a key), which is
 * normal and not worth telling anyone about.
 */
export async function modelAvailability(
  opts: { isDemo: boolean },
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Availability> {
  if (env.CUEWORK_AI_AGENT?.trim().toLowerCase() === "off") return { ok: false, reason: "The AI agent is turned off.", configured: false };

  const hosted = hostedConfig(env);
  if (hosted && hosted.kind === "hosted" && (opts.isDemo || env.CUEWORK_AI_HOSTED_FOR_ALL?.trim().toLowerCase() === "true")) {
    try {
      const res = await fetchImpl(`${hosted.url}/models`, { headers: { authorization: `Bearer ${hosted.apiKey}` }, signal: AbortSignal.timeout(5000) });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: `The ${hosted.provider} API key was rejected.`, configured: true };
      // Anything else (including a rate limit) is worth trying; chatJson retries and falls back per lead.
    } catch {
      return { ok: false, reason: `Couldn't reach ${hosted.provider}.`, configured: true };
    }
    return { ok: true, config: hosted };
  }

  const local = ollamaConfig(env);
  let tags: { models?: { name: string; model?: string }[] };
  try {
    const res = await fetchImpl(`${local.url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { ok: false, reason: `Ollama answered ${res.status}.`, configured: true };
    tags = await res.json();
  } catch {
    return { ok: false, reason: "Ollama isn't running.", configured: Boolean(env.OLLAMA_URL) };
  }
  const names = (tags.models ?? []).flatMap((m) => [m.name, m.model ?? ""]);
  const wanted = local.model.includes(":") ? local.model : `${local.model}:latest`;
  if (!names.includes(wanted)) return { ok: false, reason: `The model "${local.model}" isn't downloaded. Run: ollama pull ${local.model}`, configured: true };
  return { ok: true, config: local };
}

// ---------------------------------------------------------------------------
// Card text and guards
// ---------------------------------------------------------------------------

export interface CardText {
  title: string;
  rationale: string;
  expectedOutcome: string;
  nextStep: string;
  whyNow: string;
}

export interface EvidenceLine {
  label: string;
  value: string;
  comparison?: string | null;
}

/** Identifies the rules engine's version of a card; the agent's work is only kept while this stays the same. */
export function sourceHash(text: CardText, evidence: EvidenceLine[]): string {
  return createHash("sha256")
    .update(JSON.stringify([text.title, text.rationale, text.expectedOutcome, text.nextStep, text.whyNow, evidence.map((e) => [e.label, e.value, e.comparison ?? ""])]))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Numbers that matter in a piece of text, normalised ("1,234" → "1234", "12.50" → "12.5",
 * "33k" → "33000", "1.2M" → "1200000").
 * Small whole numbers (≤ 12) are ignored: "two weeks" vs "2 weeks", "3 months" are wording, not claims.
 */
export function significantNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmM])\b)?/g)) {
    let n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (m[2]) n *= m[2].toLowerCase() === "k" ? 1_000 : 1_000_000;
    if (Number.isInteger(n) && n <= 12) continue;
    out.add(String(Math.round(n * 1e6) / 1e6));
  }
  return out;
}

/** Numbers in `said` that aren't within `tolerance` of any number in `allowed` (rounding is fine, inventing isn't). */
export function inventedNumbers(said: string, allowed: string, tolerance = 0.05): string[] {
  const known = [...significantNumbers(allowed)].map(Number);
  return [...significantNumbers(said)].filter((s) => {
    const n = Number(s);
    return !known.some((k) => Math.abs(n - k) <= tolerance * Math.max(Math.abs(k), 1e-9));
  });
}

// ---------------------------------------------------------------------------
// One constrained request
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class ModelError extends Error {}

/**
 * Strict JSON-schema modes on hosted APIs support only a subset of JSON Schema. Strip the
 * validation keywords they may reject; the reply is re-validated against the full zod schema anyway.
 */
export function hostedSchema(schema: unknown): unknown {
  const DROP = new Set(["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format"]);
  if (Array.isArray(schema)) return schema.map(hostedSchema);
  if (schema && typeof schema === "object") {
    return Object.fromEntries(Object.entries(schema).filter(([k]) => !DROP.has(k)).map(([k, v]) => [k, hostedSchema(v)]));
  }
  return schema;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with retries on free-tier rate limits (429) and transient 5xx, honouring Retry-After. */
async function postWithRetry(fetchImpl: typeof fetch, url: string, init: RequestInit, opts: { retries?: number; baseDelayMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 2000;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(3 * 60 * 1000) });
    } catch (e) {
      throw new ModelError(e instanceof Error ? e.message : String(e));
    }
    const retryable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503;
    if (!retryable || attempt >= retries) return res;
    const header = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 60_000) : Math.min(base * 2 ** attempt, 30_000);
    await sleep(wait);
  }
}

/**
 * One request whose reply must match `schema` (enforced by the provider's structured outputs and
 * re-validated here). Throws ModelError on anything unusable.
 */
export async function chatJson<S extends z.ZodType>(
  messages: ChatMessage[],
  schema: S,
  opts: { config?: ModelConfig; fetchImpl?: typeof fetch; maxTokens?: number; retryDelayMs?: number } = {},
): Promise<z.infer<S>> {
  const config = opts.config ?? ollamaConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxTokens = opts.maxTokens ?? 700;
  let content: string | undefined;

  if (config.kind === "ollama") {
    const res = await postWithRetry(
      fetchImpl,
      `${config.url}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          format: z.toJSONSchema(schema),
          stream: false,
          think: false,
          // Qwen's recommended non-thinking sampling (low temperatures make small models loop);
          // num_predict caps a runaway reply.
          options: { num_ctx: 6144, num_predict: maxTokens, temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 },
        }),
      },
      { retries: 0 },
    );
    if (!res.ok) throw new ModelError(`Ollama returned ${res.status}.`);
    const data = (await res.json()) as { message?: { content?: string }; done_reason?: string };
    if (data.done_reason === "length") throw new ModelError("The reply ran too long.");
    content = data.message?.content;
  } else {
    const res = await postWithRetry(
      fetchImpl,
      `${config.url}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages,
          response_format: { type: "json_schema", json_schema: { name: "reply", strict: true, schema: hostedSchema(z.toJSONSchema(schema)) } },
          // Hosted models may reason before answering; leave room for that, but keep it brief.
          reasoning_effort: "low",
          max_tokens: maxTokens + 2000,
          temperature: 0.3,
        }),
      },
      { baseDelayMs: opts.retryDelayMs },
    );
    if (res.status === 429) throw new ModelError(`${config.provider} rate limit reached; try again later.`);
    if (!res.ok) throw new ModelError(`${config.provider} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw new ModelError("The reply ran too long.");
    content = choice?.message?.content ?? undefined;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content ?? "");
  } catch {
    throw new ModelError("The reply wasn't valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ModelError(`Unexpected reply shape: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
