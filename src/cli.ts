import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { symlink, mkdir, lstat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { discoverModels, FALLBACK_MODELS } from "./discovery/model-catalog.js";
import { verifyApiKey } from "./auth/verify-key.js";

const apiKey = (): string | undefined => process.env.KOURIER_API_KEY;
async function install(): Promise<void> {
  const source = resolve(new URL("../../src/index.ts", import.meta.url).pathname);
  const extensionDir = join(homedir(), ".omp/agent/extensions");
  const destination = join(extensionDir, "kourier.ts");
  await mkdir(extensionDir, { recursive: true });
  try { await lstat(destination); throw new Error(`Refusing to replace existing extension at ${destination}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await symlink(source, destination);
  console.log(`Installed Kourier extension at ${destination}`);
}
async function login(): Promise<void> {
  const key = apiKey();
  if (!key) throw new Error("Set KOURIER_API_KEY to a Kourier API key. Interactive OAuth is available via `omp login kourier`.");
  if (!(await verifyApiKey(key))) throw new Error("KOURIER_API_KEY failed Kourier model endpoint validation");
  console.log("Kourier API key verified.");
}
async function models(): Promise<void> {
  const key = apiKey();
  if (!key) { console.log(JSON.stringify(FALLBACK_MODELS, null, 2)); return; }
  console.log(JSON.stringify(await discoverModels(key), null, 2));
}
async function testConnection(): Promise<void> {
  const key = apiKey();
  if (!key) throw new Error("Set KOURIER_API_KEY before running test");
  const entries = await discoverModels(key);
  console.log(`Kourier connected; discovered ${entries.length} model(s): ${entries.map(model => model.id).join(", ")}`);
}
async function loginPrompt(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const key = (await rl.question("Paste Kourier API key: ")).trim().replace(/^Bearer\s+/i, "");
    if (!(await verifyApiKey(key))) throw new Error("Kourier API key is invalid or could not be verified");
    console.log("Kourier API key verified. Set KOURIER_API_KEY in your environment or run `omp login kourier`.");
  } finally { rl.close(); }
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] ?? "help";
  if (command === "install") return install();
  if (command === "login") return loginPrompt();
  if (command === "models") return models();
  if (command === "test") return testConnection();
  if (command === "help" || command === "--help" || command === "-h") {
    console.log("Usage: omp-provider-kourier <install|login|models|test>\n  install  Symlink the provider into ~/.omp/agent/extensions\n  login    Validate a pasted Kourier API key\n  models   List live models (or fallback catalog without a key)\n  test     Verify API key and model discovery");
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
