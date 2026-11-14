import { describe, expect, test } from "bun:test";
import { loginWithServiceAuth, nextPollDelay } from "../src/auth/service-auth.js";
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
    const tokenBodies: URLSearchParams[] = [];
    let polls = 0;
    const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url).endsWith("/agent/identity")) {
        expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
        expect(JSON.parse(String(init?.body))).toEqual({ type: "service_auth", login_hint: "member@example.com", client_name: "omp" });
        return Response.json({ claim_token: "claim-1", claim: { verification_uri: "https://app.kourier.sh/verify", user_code: "123456", expires_in: 20, interval: 1 } });
      }
      expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
      tokenBodies.push(new URLSearchParams(String(init?.body)));
      polls++;
      if (polls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
      if (polls === 2) return Response.json({ error: "slow_down" }, { status: 400 });
      return Response.json({ api_key: "sk-bf-issued", refresh_token: "r1", expires_in: 3600 });
    };
    const received: string[] = [];
    const result = await loginWithServiceAuth({ ...callbacks("member@example.com"), onAuth: info => { received.push(info.instructions ?? ""); } }, { fetch: fetcher, pollIntervalMs: 1000 });
    expect(result).toMatchObject({ access: "sk-bf-issued", apiKey: "sk-bf-issued", accessToken: "sk-bf-issued", refresh: "r1", email: "member@example.com" });
    expect(received[0]).toContain("Code: 123456");
    expect(tokenBodies.every(body => body.get("grant_type") === "urn:workos:agent-auth:grant-type:claim" && body.get("claim_token") === "claim-1")).toBe(true);
  }, 30_000);  // slow_down now adds 5 s before the poll that mints the key
  test("slow_down increases the interval for every later poll", async () => {
    // Control: the pure backoff rule itself.
    expect(nextPollDelay(1000, false)).toBe(1000);
    expect(nextPollDelay(1000, true)).toBe(6000);
    expect(nextPollDelay(nextPollDelay(1000, true), true)).toBe(11000);

    // Behaviour: observe the real gaps between token polls. Poll 2 returns
    // slow_down, so polls 3 and 4 must each wait 5000 ms longer than poll 1.
    const stamps: number[] = [];
    let polls = 0;
    const fetcher = async (url: string | URL | Request): Promise<Response> => {
      if (String(url).endsWith("/agent/identity")) {
        return Response.json({ claim_token: "claim-1", verification_uri: "https://app.kourier.sh/verify", user_code: "123456", expires_in: 60, interval: 1 });
      }
      stamps.push(Date.now());
      polls++;
      if (polls === 2) return Response.json({ error: "slow_down" }, { status: 400 });
      if (polls < 4) return Response.json({ error: "authorization_pending" }, { status: 400 });
      return Response.json({ api_key: "sk-bf-issued" });
    };
    await loginWithServiceAuth(callbacks("member@example.com"), { fetch: fetcher, pollIntervalMs: 1000 });

    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    expect(gaps).toHaveLength(3);
    // Before the fix every gap was ~1000 ms and this failed.
    expect(gaps[0]).toBeGreaterThanOrEqual(900);   // poll 1 -> 2: base interval
    expect(gaps[1]).toBeGreaterThanOrEqual(5900);  // after slow_down
    expect(gaps[2]).toBeGreaterThanOrEqual(5900);  // still backed off on later polls
  }, 60_000);
  test("parses form-encoded token error responses", async () => {
    const fetcher = async (url: string | URL | Request): Promise<Response> => String(url).endsWith("/agent/identity")
      ? Response.json({ claim_token: "claim-1", verification_url: "https://app.kourier.sh/verify", user_code: "123456", expires_in: 20, interval: 1 })
      : new Response("error=expired_token", { status: 400, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    await expect(loginWithServiceAuth(callbacks("person@example.com"), { fetch: fetcher })).rejects.toThrow("expired");
  });
});
