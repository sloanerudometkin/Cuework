import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { chatJson, hostedConfig, hostedSchema, modelAvailability } from "@/lib/services/ai-model";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const groqEnv = { CUEWORK_AI_PROVIDER: "groq", GROQ_API_KEY: "test-key" };
const ollamaUp = (async (url: string) =>
  String(url).endsWith("/api/tags") ? json({ models: [{ name: "qwen3:4b" }] }) : json({}, 200)) as unknown as typeof fetch;

describe("hostedConfig", () => {
  it("uses presets, provider-specific or generic keys, and overrides", () => {
    expect(hostedConfig({})).toBeNull();
    expect(hostedConfig({ CUEWORK_AI_PROVIDER: "groq" })).toBeNull(); // no key
    expect(hostedConfig(groqEnv)).toEqual({ kind: "hosted", provider: "groq", url: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", apiKey: "test-key" });
    expect(hostedConfig({ CUEWORK_AI_PROVIDER: "gemini", AI_API_KEY: "k", AI_MODEL: "gemini-x" })).toMatchObject({ provider: "gemini", model: "gemini-x", url: "https://generativelanguage.googleapis.com/v1beta/openai" });
    expect(hostedConfig({ CUEWORK_AI_PROVIDER: "openai-compatible", AI_API_KEY: "k", AI_BASE_URL: "https://llm.example/v1/", AI_MODEL: "m" })).toMatchObject({ url: "https://llm.example/v1" });
  });
});

describe("modelAvailability (hosted)", () => {
  it("sends only demo workspaces to a hosted free tier, unless told otherwise", async () => {
    expect(await modelAvailability({ isDemo: true }, groqEnv, ollamaUp)).toMatchObject({ ok: true, config: { kind: "hosted", provider: "groq" } });
    // Real workspace: falls back to local Ollama instead of sending its data to the provider.
    expect(await modelAvailability({ isDemo: false }, groqEnv, ollamaUp)).toMatchObject({ ok: true, config: { kind: "ollama" } });
    expect(await modelAvailability({ isDemo: false }, { ...groqEnv, CUEWORK_AI_HOSTED_FOR_ALL: "true" }, ollamaUp)).toMatchObject({ ok: true, config: { kind: "hosted" } });
  });
  it("reports a rejected key", async () => {
    const denied = (async () => json({ error: "nope" }, 401)) as unknown as typeof fetch;
    expect(await modelAvailability({ isDemo: true }, groqEnv, denied)).toEqual({ ok: false, reason: "The groq API key was rejected.", configured: true });
  });
});

describe("chatJson (hosted)", () => {
  const schema = z.object({ verdict: z.enum(["keep", "drop"]), reason: z.string().min(3).max(50) });
  const config = hostedConfig(groqEnv)!;

  it("asks for strict JSON-schema output with the key, and validates the reply", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return json({ choices: [{ message: { content: JSON.stringify({ verdict: "keep", reason: "Looks real." }) }, finish_reason: "stop" }] });
    }) as unknown as typeof fetch;
    expect(await chatJson([{ role: "user", content: "hi" }], schema, { config, fetchImpl: fake })).toEqual({ verdict: "keep", reason: "Looks real." });
    expect(sent!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((sent!.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const body = JSON.parse(sent!.init.body as string);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    // Validation keywords strict modes may reject are stripped; zod still enforces them on the reply.
    expect(JSON.stringify(body.response_format.json_schema.schema)).not.toMatch(/maxLength|minLength|\$schema/);
  });

  it("retries rate limits, then gives up with a clear error", async () => {
    let calls = 0;
    const limited = (async () => {
      calls++;
      return calls < 3 ? json({ error: "slow down" }, 429) : json({ choices: [{ message: { content: '{"verdict":"drop","reason":"Seasonal."}' } }] });
    }) as unknown as typeof fetch;
    expect(await chatJson([{ role: "user", content: "hi" }], schema, { config, fetchImpl: limited, retryDelayMs: 1 })).toEqual({ verdict: "drop", reason: "Seasonal." });
    expect(calls).toBe(3);
    const always = (async () => json({}, 429)) as unknown as typeof fetch;
    await expect(chatJson([{ role: "user", content: "hi" }], schema, { config, fetchImpl: always, retryDelayMs: 1 })).rejects.toThrow(/rate limit/);
  });

  it("rejects cut-off or off-schema replies", async () => {
    const cut = (async () => json({ choices: [{ message: { content: '{"verdict":"ke' }, finish_reason: "length" }] })) as unknown as typeof fetch;
    await expect(chatJson([{ role: "user", content: "hi" }], schema, { config, fetchImpl: cut })).rejects.toThrow(/too long/);
    const off = (async () => json({ choices: [{ message: { content: '{"verdict":"maybe","reason":"x"}' } }] })) as unknown as typeof fetch;
    await expect(chatJson([{ role: "user", content: "hi" }], schema, { config, fetchImpl: off })).rejects.toThrow(/Unexpected reply shape/);
  });

  it("strips nested keywords too", () => {
    expect(hostedSchema({ type: "object", properties: { a: { type: "string", maxLength: 5 } }, $schema: "x" })).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });
});

describe("inventedNumbers", () => {
  it("accepts rounding and k/M shorthand, rejects numbers with no close match", async () => {
    const { inventedNumbers } = await import("@/lib/services/ai-model");
    const data = "32,848 impressions, 706–1,176 clicks, 30,250 sessions, ≈522 conversions lost, CTR 9.93%";
    expect(inventedNumbers("About 33k impressions, roughly 700–1,200 clicks, ~30,000 sessions, 500 conversions, 9.9%", data)).toEqual([]);
    expect(inventedNumbers("This could add 4,000 clicks and a 70% lift.", data)).toEqual(["4000", "70"]);
  });
});
