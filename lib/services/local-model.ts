import { createHash } from "node:crypto";
import { z } from "zod/v4";

/**
 * Talking to a free, open-weight model running locally in Ollama. No paid AI service is
 * involved. Small local models are reliable when every request is short and the reply is
 * constrained to a fixed JSON shape, so that's the only way this module talks to them.
 */

/** Small enough for an 8 GB Mac. Override with OLLAMA_MODEL. */
export const DEFAULT_MODEL = "qwen3:4b";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface ModelConfig {
  url: string;
  model: string;
}

export function modelConfig(env: Record<string, string | undefined> = process.env): ModelConfig {
  return {
    url: (env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, ""),
    model: env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export type Availability = { ok: true } | { ok: false; reason: string; configured: boolean };

/**
 * Whether the local model can run right now. `configured: false` means there's simply no
 * Ollama here (e.g. production), which is normal and not worth telling anyone about.
 */
export async function modelAvailability(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Availability> {
  if (env.CUEWORK_AI_AGENT?.trim().toLowerCase() === "off") return { ok: false, reason: "The AI agent is turned off.", configured: false };
  const { url, model } = modelConfig(env);
  let tags: { models?: { name: string; model?: string }[] };
  try {
    const res = await fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { ok: false, reason: `Ollama answered ${res.status}.`, configured: true };
    tags = await res.json();
  } catch {
    return { ok: false, reason: "Ollama isn't running.", configured: Boolean(env.OLLAMA_URL) };
  }
  const names = (tags.models ?? []).flatMap((m) => [m.name, m.model ?? ""]);
  const wanted = model.includes(":") ? model : `${model}:latest`;
  if (!names.includes(wanted)) return { ok: false, reason: `The model "${model}" isn't downloaded. Run: ollama pull ${model}`, configured: true };
  return { ok: true };
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
 * Numbers that matter in a piece of text, normalised ("1,234" → "1234", "12.50" → "12.5").
 * Small whole numbers (≤ 12) are ignored: "two weeks" vs "2 weeks", "3 months" are wording, not claims.
 */
export function significantNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && n <= 12) continue;
    out.add(String(n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// One constrained request
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LocalModelError extends Error {}

/**
 * One request whose reply must match `schema` (enforced by Ollama's structured outputs and
 * re-validated here). Throws LocalModelError on anything unusable.
 */
export async function chatJson<S extends z.ZodType>(
  messages: ChatMessage[],
  schema: S,
  opts: { config?: ModelConfig; fetchImpl?: typeof fetch; maxTokens?: number } = {},
): Promise<z.infer<S>> {
  const { url, model } = opts.config ?? modelConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(3 * 60 * 1000),
      body: JSON.stringify({
        model,
        messages,
        format: z.toJSONSchema(schema),
        stream: false,
        think: false,
        // Qwen's recommended non-thinking sampling (low temperatures make small models loop);
        // num_predict caps a runaway reply.
        options: { num_ctx: 6144, num_predict: opts.maxTokens ?? 700, temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 },
      }),
    });
  } catch (e) {
    throw new LocalModelError(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new LocalModelError(`Ollama returned ${res.status}.`);
  const data = (await res.json()) as { message?: { content?: string }; done_reason?: string };
  if (data.done_reason === "length") throw new LocalModelError("The reply ran too long.");
  let raw: unknown;
  try {
    raw = JSON.parse(data.message?.content ?? "");
  } catch {
    throw new LocalModelError("The reply wasn't valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new LocalModelError(`Unexpected reply shape: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
