import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Live checks for Kourier's OpenAI Responses surface (POST /v1/responses).
// These pin the constraints that keep this plugin on openai-completions: if the
// endpoint ever accepts content parts, the image-less Responses path may become
// viable and this test should start failing so the decision is revisited.
function apiKey(): string | undefined {
  if (process.env.KOURIER_API_KEY) return process.env.KOURIER_API_KEY;
  try {
    const line = readFileSync(join(homedir(), ".omp/agent/.env"), "utf8")
      .split("\n").find(l => l.startsWith("KOURIER_API_KEY="));
    return line?.split("=").slice(1).join("=").trim() || undefined;
  } catch { return undefined; }
}

const key = apiKey();

async function post(body: Record<string, unknown>) {
  const response = await fetch("https://api.kourier.sh/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "omp-provider-kourier-test" },
    body: JSON.stringify({ model: "deepseek-v4.1-flash", ...body }),
  });
  return { status: response.status, json: await response.json() as any };
}

const tools = [{ type: "function", name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }];

describe.skipIf(!key)("Kourier Responses endpoint (live)", () => {
  test("accepts a plain string input and streams reasoning as output items", async () => {
    // A trivial prompt often skips thinking entirely, so use one that reliably reasons.
    const { status, json } = await post({ input: "Compute 847 * 1293 step by step.", max_output_tokens: 2000, reasoning: { effort: "high" } });
    expect(status).toBe(200);
    const kinds = json.output.map((o: any) => o.type);
    expect(kinds).toContain("message");
    // reasoning is a first-class output item, not a delta-only field
    expect(kinds).toContain("reasoning");
    expect(json.usage.output_tokens_details.reasoning_tokens).toBeGreaterThan(0);
  }, 60_000);

  test("rejects content-part arrays, which is why omp cannot use this surface", async () => {
    const { status, json } = await post({ input: [{ role: "user", content: [{ type: "input_text", text: "say OK" }] }], max_output_tokens: 200 });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toContain("input_text");
  }, 60_000);

  test("medium is rejected and function_call_output uses the `output` field", async () => {
    const bad = await post({ input: "say OK", max_output_tokens: 200, reasoning: { effort: "medium" } });
    expect(bad.status).toBe(400);

    const first = await post({ input: "read /tmp/x.txt", tools, max_output_tokens: 800, reasoning: { effort: "none" } });
    expect(first.status).toBe(200);
    const call = first.json.output.find((o: any) => o.type === "function_call");
    expect(call.name).toBe("read");

    // `output` is the field; `content` is a validation error.
    const wrong = await post({
      input: [{ role: "user", content: "read /tmp/x.txt" },
              { type: "function_call_output", call_id: call.call_id, content: "ZANZIBAR-42" }],
      tools, max_output_tokens: 500,
    });
    expect(wrong.status).toBe(400);

    const right = await post({
      input: [{ role: "user", content: "read /tmp/x.txt" },
              { type: "function_call_output", call_id: call.call_id, output: "ZANZIBAR-42" }],
      tools, max_output_tokens: 900, reasoning: { effort: "high" },
    });
    expect(right.status).toBe(200);
    const text = right.json.output.filter((o: any) => o.type === "message").flatMap((o: any) => o.content).map((c: any) => c.text).join(" ");
    expect(text).toContain("ZANZIBAR-42");
  }, 120_000);

  test("previous_response_id is not supported: the server is stateless", async () => {
    const first = await post({ input: "say OK", max_output_tokens: 200, reasoning: { effort: "none" } });
    const chained = await post({ previous_response_id: first.json.id, input: "again", max_output_tokens: 200 });
    expect(chained.status).toBe(404);
  }, 60_000);
});
