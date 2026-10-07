import { describe, expect, test } from "bun:test";
import { loginWithServiceAuth } from "../src/auth/service-auth.js";
import { verifyApiKey } from "../src/auth/verify-key.js";
import type { OAuthLoginCallbacks } from "../src/types.js";

const callbacks = (email: string): OAuthLoginCallbacks => ({ onAuth() {}, onPrompt: async () => email, onProgress() {} });

describe("Kourier authentication", () => {
  test("validates pasted bearer keys against the models endpoint", async () => {
    expect(await verifyApiKey("Bearer sk-bf-valid", { fetch: async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-bf-valid");
      return new Response("{}", { status: 200 });
    } })).toBe(true);
    expect(await verifyApiKey("bad\nkey", { fetch: fetch })).toBe(false);
  });
  test("polls identity claim through pending and slow-down to a minted key", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let polls = 0;
    const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url).endsWith("/agent/identity")) return Response.json({ claim_token: "claim-1", verification_url: "https://app.kourier.sh/verify", user_code: "123456", expires_in: 20, interval: 1 });
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      polls++;
      if (polls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
      if (polls === 2) return Response.json({ error: "slow_down" }, { status: 400 });
      return Response.json({ api_key: "sk-bf-issued" });
    };
    const received: string[] = [];
    const result = await loginWithServiceAuth({ ...callbacks("member@example.com"), onAuth: info => { received.push(info.userCode ?? ""); } }, { fetch: fetcher, pollIntervalMs: 1000 });
    expect(result.apiKey).toBe("sk-bf-issued");
    expect(received).toEqual(["123456"]);
    expect(bodies.every(body => body.claim_token === "claim-1")).toBe(true);
  });
  test("surfaces expired device claims", async () => {
    const fetcher = async (url: string | URL | Request): Promise<Response> => String(url).endsWith("/agent/identity")
      ? Response.json({ claim_token: "claim-1", verification_uri: "https://app.kourier.sh/verify", user_code: "123456", expires_in: 20, interval: 1 })
      : Response.json({ error: "expired_token" }, { status: 400 });
    await expect(loginWithServiceAuth(callbacks("person@example.com"), { fetch: fetcher })).rejects.toThrow("expired");
  });
});
