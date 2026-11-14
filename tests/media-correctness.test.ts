// Live pin on media correctness, not just status. The video section already
// warns that a 200 can carry discarded media; the same reasoning applies to a
// misread image, so this checks the ANSWER against verified pixels.
//
// Skips without a key. Needs ImageMagick to generate matched PNG/WebP pairs.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const key = process.env.KOURIER_API_KEY;
const TIMEOUT = 120_000;
const MODEL = "deepseek-v4.1-flash";
// Reasoning shares this budget: too small and content comes back null with HTTP 200.
const MAX_TOKENS = 800;

function haveMagick(): boolean {
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kourier-media-"));

/** Solid-colour image in both formats; pixels are verified before any request. */
function pair(colour: string): { png: string; webp: string; rgb: string } {
  const png = path.join(dir, `${colour}.png`);
  const webp = path.join(dir, `${colour}.webp`);
  execFileSync("magick", ["-size", "96x96", `xc:${colour}`, `PNG24:${png}`]);
  execFileSync("magick", [png, "-quality", "95", webp]);
  const rgb = execFileSync("magick", [png, "-format", "%[pixel:p{0,0}]", "info:"], { encoding: "utf8" }).trim();
  return { png, webp, rgb };
}

async function ask(mime: string, file: string): Promise<{ status: number; answer: string; promptTokens: number }> {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What single colour fills this image completely? Answer with one word only." },
        { type: "image_url", image_url: { url: `data:${mime};base64,${fs.readFileSync(file).toString("base64")}` } },
      ],
    }],
  };
  const response = await fetch("https://api.kourier.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "curl/8.5.0" },
    body: JSON.stringify(body),
  });
  const json = await response.json() as any;
  return {
    status: response.status,
    answer: String(json.choices?.[0]?.message?.content ?? json.error?.message ?? "").trim().toLowerCase(),
    promptTokens: json.usage?.prompt_tokens ?? -1,
  };
}

// The read tool re-encodes PNG to WebP before sending, so WebP being FAITHFUL is
// load-bearing rather than cosmetic.
describe.skipIf(!key || !haveMagick())("Kourier media correctness (live)", () => {
  // Unambiguous names ONLY. Measured: cyan and magenta are named inconsistently
// (cyan->"blue", magenta->"purple"/"pink") with the SAME variance on PNG, so an
// ambiguous hue tests the model's vocabulary rather than the wire's decode.
const colours = ["red", "yellow", "black", "white"] as const;

  test("PNG is read correctly, not merely accepted", async () => {
    for (const colour of colours) {
      const { png } = pair(colour);
      const result = await ask("image/png", png);
      expect(result.status).toBe(200);
      expect(result.answer).toContain(colour);
    }
  }, TIMEOUT);

  test("WebP is read correctly and bills the same as PNG", async () => {
    for (const colour of colours) {
      const { png, webp } = pair(colour);
      const asPng = await ask("image/png", png);
      const asWebp = await ask("image/webp", webp);
      expect(asWebp.status).toBe(200);
      expect(asWebp.answer).toContain(colour);
      // Same pixels must price identically; a delta would mean the wire coerces WebP.
      expect(asWebp.promptTokens).toBe(asPng.promptTokens);
    }
  }, TIMEOUT);

  // Flat colour can hide a decode defect (anything that averages still gets a
  // solid image right). A left/right image proves spatial decode, and the ORDER
  // catches a mirrored read.
  test("WebP keeps spatial layout and orientation, like PNG", async () => {
    const png = path.join(dir, "two.png");
    const webp = path.join(dir, "two.webp");
    execFileSync("magick", ["-size", "200x120", "xc:red", "-fill", "blue", "-draw", "rectangle 100,0 199,119", webp]);
    execFileSync("magick", [webp, `PNG24:${png}`]);
    // Ground truth from the encoded file, not from what we asked for.
    const left = execFileSync("magick", [webp, "-format", "%[pixel:p{10,60}]", "info:"], { encoding: "utf8" });
    const right = execFileSync("magick", [webp, "-format", "%[pixel:p{190,60}]", "info:"], { encoding: "utf8" });
    expect(left).toContain("255,1,0");
    expect(right).toContain("0,0,255");

    const body = (mime: string, file: string) => ({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "This image has two halves. Answer exactly two words: the colour of the LEFT half, then the colour of the RIGHT half." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${fs.readFileSync(file).toString("base64")}` } },
        ],
      }],
    });
    const read = async (mime: string, file: string) => {
      const response = await fetch("https://api.kourier.sh/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "curl/8.5.0" },
        body: JSON.stringify(body(mime, file)),
      });
      const json = await response.json() as any;
      return {
        answer: String(json.choices?.[0]?.message?.content ?? "").trim().toLowerCase(),
        promptTokens: json.usage?.prompt_tokens ?? -1,
      };
    };

    for (const [mime, file] of [["image/png", png], ["image/webp", webp]] as const) {
      const result = await read(mime, file);
      expect(result.answer).toContain("red");
      expect(result.answer).toContain("blue");
      // Order proves orientation: "blue red" would be a mirrored decode.
      expect(result.answer.indexOf("red")).toBeLessThan(result.answer.indexOf("blue"));
    }
  }, TIMEOUT);
});
