import { describe, expect, test } from "bun:test";
import { discoverModels, FALLBACK_MODELS } from "../src/discovery/model-catalog.js";

describe("Kourier model discovery", () => {
  test("maps the live primary model with exact provider capabilities", async () => {
    const models = await discoverModels("secret", { fetch: async input => {
      expect(String(input)).toBe("https://api.kourier.sh/v1/models");
      return Response.json({ data: [{ id: "deepseek-v4.1-flash", name: "Flash", context_length: 262144, max_output_tokens: 16384, capabilities: { reasoning: true, vision: true } }] });
    } });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ api: "openai-completions", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 16384, thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh", "max"], defaultLevel: "high" }, cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 } });
  });
  test("defaults maxTokens to the thinking-mode budget, not Kourier's documented 16K cap", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "deepseek-v4.1-flash" }] }) });
    expect(models[0].maxTokens).toBe(65536);
  });
  test("keeps vision when the catalog omits capabilities", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "deepseek-v4.1-flash", object: "model", owned_by: "kourier" }] }) });
    expect(models[0].input).toEqual(["text", "image"]);
  });
  test("honors an explicit text-only capability", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "deepseek-v4.1-flash", capabilities: { vision: false } }] }) });
    expect(models[0].input).toEqual(["text"]);
  });
  test("ignores malformed rows and falls back for an empty catalog", async () => {
    const result = await discoverModels("key", { fetch: async () => Response.json({ data: [{ name: "missing id" }] }) });
    expect(result).toEqual(FALLBACK_MODELS);
  });
  test("rejects failed discovery responses", async () => {
    expect(discoverModels("key", { fetch: async () => new Response("", { status: 503 }) })).rejects.toThrow("503");
  });
});
