import { describe, expect, test } from "bun:test";
import { discoverModels, FALLBACK_MODELS } from "../src/discovery/model-catalog.js";

describe("Kourier model discovery", () => {
  test("maps the live primary model with exact provider capabilities", async () => {
    const models = await discoverModels("secret", { fetch: async input => {
      expect(String(input)).toBe("https://api.kourier.sh/v1/models");
      return Response.json({ data: [{ id: "deepseek-v4.1-flash", name: "Flash", context_length: 262144, max_output_tokens: 16384, capabilities: { reasoning: true, vision: true } }] });
    } });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ api: "openai-completions", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 16384, thinking: { mode: "effort", efforts: ["low", "medium", "high", "xhigh", "max"], defaultLevel: "high" }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  });
  test("defaults maxTokens to the thinking-mode budget, not Kourier's documented 16K cap", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "deepseek-v4.1-flash" }] }) });
    expect(models[0].maxTokens).toBe(65536);
  });
  test("keeps vision when the catalog omits capabilities", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "deepseek-v4.1-flash", object: "model", owned_by: "kourier" }] }) });
    expect(models[0].input).toEqual(["text", "image"]);
  });
  test("applies the wire compat to every discovered model, not just the primary", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [
      { id: "deepseek-v4.1-flash" },
      { id: "some-other-model", capabilities: { reasoning: true, vision: true } },
    ] }) });
    expect(models).toHaveLength(2);
    for (const model of models) {
      // Bare `medium` 400s and reasoning streams in `reasoning` for every id
      // behind the same Bifrost front, so the wire compat is per-provider fact.
      expect(model.compat).toMatchObject({ reasoningContentField: "reasoning", supportsReasoningEffort: true });
      expect(model.thinking).toMatchObject({ mode: "effort", defaultLevel: "high" });
    }
  });
  test("does not offer an effort ladder to a non-reasoning row", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "text-only-model", capabilities: { reasoning: false } }] }) });
    expect(models[0].thinking).toBeUndefined();
    expect(models[0].compat).toMatchObject({ reasoningContentField: "reasoning" });
  });
  test("does not claim vision for a non-primary id until it declares it", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "undeclared-model" }] }) });
    expect(models[0].input).toEqual(["text"]);
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
  // Kourier bills a flat subscription with no token quotas, so a non-zero rate
  // card would report spend the user never incurs — and would be wrong for any
  // family other than the one it was copied from.
  test("prices every discovered model at the flat subscription rate, never an upstream card", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [
      { id: "deepseek-v4.1-flash" },
      { id: "claude-sonnet-4-5" },
    ] }) });
    for (const model of models) expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });
  // `medium` -> `high` is a DeepSeek 400 workaround. A future non-DeepSeek id
  // must not inherit it, or its requested effort silently moves a rung.
  test("scopes the DeepSeek effort rewrite to the DeepSeek family", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [
      { id: "deepseek-v4.1-flash" },
      { id: "claude-sonnet-4-5" },
    ] }) });
    const [deepseek, sonnet] = models;
    expect(deepseek.compat).toMatchObject({ reasoningEffortMap: { minimal: "low", medium: "high", xhigh: "high" } });
    expect(sonnet.compat?.reasoningEffortMap).toEqual({ minimal: "low" });
    // The Bifrost wire facts still apply to every id, whatever the family.
    for (const model of models) expect(model.compat).toMatchObject({ reasoningContentField: "reasoning", supportsReasoningEffort: true });
  });
  // An unclassified id takes the dropped map on purpose, not by oversight: a
  // wrong rewrite silently moves the user's effort rung, and the host already
  // heals a rejected `medium` by retrying the nearest rung.
  test("does not rewrite effort for an unclassified id", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [{ id: "some-unknown-thing" }] }) });
    expect(models[0].compat?.reasoningEffortMap).toEqual({ minimal: "low" });
  });
  // GET /models sends no capability block and no limits, so a future id must not
  // inherit DeepSeek's: an over-claimed window makes the host send a prompt past
  // the real one and take a 400, while an under-claimed one only compacts early.
  test("does not give an undeclared non-primary id DeepSeek's window or ladder", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [
      { id: "deepseek-v4.1-flash", object: "model", owned_by: "kourier" },
      { id: "some-future-model", object: "model", owned_by: "kourier" },
    ] }) });
    const [primary, future] = models;
    expect(primary.contextWindow).toBe(262144);
    expect(primary.maxTokens).toBe(65536);
    expect(primary.thinking).toBeDefined();
    expect(future.contextWindow).toBe(32768);
    expect(future.maxTokens).toBe(8192);
    // No declared reasoning, so no unearned effort ladder.
    expect(future.reasoning).toBe(false);
    expect(future.thinking).toBeUndefined();
  });
  test("honours a declared window and reasoning for a non-primary id", async () => {
    const models = await discoverModels("secret", { fetch: async () => Response.json({ data: [
      { id: "some-future-model", context_window: 8192, max_output_tokens: 2048, capabilities: { reasoning: true } },
    ] }) });
    expect(models[0].contextWindow).toBe(8192);
    expect(models[0].maxTokens).toBe(2048);
    expect(models[0].thinking).toBeDefined();
  });
});
