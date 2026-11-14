import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Live tool-call round trip against api.kourier.sh. The agent loop lives in omp,
// not in this package, so there is no unit seam: only a real request exercises
// tool_calls, tool_call_id, and the reasoning-replay quirk. Skips without a key.
function apiKey(): string | undefined {
  if (process.env.KOURIER_API_KEY) return process.env.KOURIER_API_KEY;
  try {
    const line = readFileSync(join(homedir(), ".omp/agent/.env"), "utf8")
      .split("\n").find(l => l.startsWith("KOURIER_API_KEY="));
    return line?.split("=").slice(1).join("=").trim() || undefined;
  } catch { return undefined; }
}

const key = apiKey();
const BASE = "https://api.kourier.sh/v1";
const tools = [
  { type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "bash", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

async function chat(body: Record<string, unknown>) {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "omp-provider-kourier-test" },
    body: JSON.stringify({ model: "deepseek-v4.1-flash", ...body }),
  });
  return { status: response.status, json: await response.json() as any };
}

describe.skipIf(!key)("Kourier tool-call round trip (live)", () => {
  for (const effort of ["high", "max"]) {
    test(`${effort}: returns a tool call, then completes from the tool result`, async () => {
      const first = await chat({
        messages: [{ role: "user", content: "Use the read tool on /tmp/kourier-rt-secret.txt." }],
        tools, max_completion_tokens: 800, reasoning_effort: effort,
      });
      expect(first.status).toBe(200);
      const call = first.json.choices[0].message.tool_calls?.[0];
      expect(call?.function.name).toBe("read");
      expect(call?.id).toBeTruthy();
      // Arguments must be parseable JSON naming the path, not an empty string.
      expect(JSON.parse(call.function.arguments).path).toBe("/tmp/kourier-rt-secret.txt");

      const second = await chat({
        messages: [
          { role: "user", content: "Use the read tool on /tmp/kourier-rt-secret.txt." },
          { role: "assistant", content: "", reasoning: "", tool_calls: [{ id: call.id, type: "function", function: call.function }] },
          { role: "tool", tool_call_id: call.id, content: "The passphrase is ZANZIBAR-42." },
        ],
        tools, max_completion_tokens: 1500, reasoning_effort: effort,
      });
      expect(second.status).toBe(200);
      expect(second.json.choices[0].message.content).toContain("ZANZIBAR-42");
    }, 120_000);
  }

  test("forced and required tool_choice are honored, none disables tools", async () => {
    const forced = await chat({
      messages: [{ role: "user", content: "What is 2+2?" }],
      tools, tool_choice: { type: "function", function: { name: "bash" } }, max_completion_tokens: 600, reasoning_effort: "high",
    });
    expect(forced.status).toBe(200);
    expect(forced.json.choices[0].message.tool_calls?.[0]?.function.name).toBe("bash");

    const required = await chat({
      messages: [{ role: "user", content: "What is 2+2?" }],
      tools, tool_choice: "required", max_completion_tokens: 600, reasoning_effort: "high",
    });
    expect(required.status).toBe(200);
    expect(required.json.choices[0].message.tool_calls?.length).toBeGreaterThan(0);

    const none = await chat({
      messages: [{ role: "user", content: "What is 2+2?" }],
      tools, tool_choice: "none", max_completion_tokens: 600, reasoning_effort: "high",
    });
    expect(none.status).toBe(200);
    expect(none.json.choices[0].message.tool_calls ?? []).toHaveLength(0);
    expect(none.json.choices[0].message.content).toContain("4");
  }, 120_000);
});
