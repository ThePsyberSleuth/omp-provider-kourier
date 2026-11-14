// Pins the compat facts that are only true because they were measured against
// api.kourier.sh. The model id classifies as the DeepSeek family, so the catalog
// applies DeepSeek-on-its-own-API rules to this Bifrost front; every one of them
// is false here, and inheriting them silently degrades agentic turns.
import { describe, expect, test } from "bun:test";
import { KOURIER_COMPAT } from "../src/types.js";
import { FALLBACK_MODELS } from "../src/discovery/model-catalog.js";

describe("Kourier wire compat", () => {
  test("names the field the wire actually streams reasoning in", () => {
    // Measured: streamed deltas carry `reasoning` (+ reasoning_details), never
    // `reasoning_content` — the openai-completions catalog default.
    expect(KOURIER_COMPAT.reasoningContentField).toBe("reasoning");
  });

  test("does not suppress reasoning when tools are sent", () => {
    // Measured: reasoning_effort with tools + tool_choice returns reasoning
    // tokens. The inherited DeepSeek rule would drop reasoning on every
    // agentic turn (openai-shared.ts sets disableReason: "tool-choice").
    expect(KOURIER_COMPAT.disableReasoningOnToolChoice).toBe(false);
  });

  test("does not demand reasoning content on replayed tool calls", () => {
    // Measured: replaying assistant turns without reasoning_content succeeds,
    // so requiring it would only risk rejecting valid history.
    expect(KOURIER_COMPAT.requiresReasoningContentForToolCalls).toBe(false);
    expect(KOURIER_COMPAT.requiresReasoningContentForAllAssistantTurns).toBe(false);
  });

  test("rewrites the one effort literal the endpoint rejects", () => {
    // Measured: `medium` 400s; low/high/xhigh/max and 1-100 integers are accepted.
    expect(KOURIER_COMPAT.reasoningEffortMap).toMatchObject({ medium: "high", minimal: "low" });
  });

  test("every fallback model carries the wire compat", () => {
    for (const model of FALLBACK_MODELS) expect(model.compat).toBe(KOURIER_COMPAT);
  });
});
