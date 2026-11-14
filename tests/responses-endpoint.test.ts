import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

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

function solidPng(r: number, g: number, b: number): string {
  const raw = Array.from({ length: 40 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(40 * 3, 0)]));
  for (const row of raw) for (let x = 0; x < 40; x++) row.set([r, g, b], 1 + x * 3);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(40, 0); ihdr.writeUInt32BE(40, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function messageText(json: any): string {
  return (json.output ?? []).filter((o: any) => o.type === "message").flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ");
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

  test("rejects text content parts but accepts input_image ones", async () => {
    // Text parts — the shape omp emits — are rejected on this surface.
    for (const partType of ["input_text", "text"]) {
      const bad = await post({ input: [{ role: "user", content: [{ type: partType, text: "say OK" }] }], max_output_tokens: 200 });
      expect(bad.status).toBe(400);
    }

    // An image part on its own is accepted, with the instruction in a separate
    // plain-string message (an image part cannot be combined with any text part).
    const image = `data:image/png;base64,${solidPng(0, 0, 255)}`;
    const ok = await post({
      input: [
        { role: "user", content: "What color is the image? Answer with one word." },
        { role: "user", content: [{ type: "input_image", image_url: image }] },
      ],
      max_output_tokens: 300, reasoning: { effort: "none" },
    });
    expect(ok.status).toBe(200);
    expect(messageText(ok.json).toLowerCase()).toContain("blue");
  }, 120_000);

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
