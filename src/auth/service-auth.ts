import { KOURIER_AUTH_BASE, type FetchLike, type OAuthCredentials, type OAuthLoginCallbacks } from "../types.js";

interface IdentityResponse { claim_token?: string; verification_uri?: string; verification_url?: string; user_code?: string; expires_in?: number; interval?: number }
interface TokenResponse { access_token?: string; api_key?: string; token_type?: string; error?: string; error_description?: string; expires_in?: number; refresh_token?: string }

export async function loginWithServiceAuth(callbacks: OAuthLoginCallbacks, options: { fetch?: FetchLike; authBase?: string; pollIntervalMs?: number } = {}): Promise<OAuthCredentials> {
  const email = (await callbacks.onPrompt({ message: "Email address for Kourier agent sign-in", placeholder: "you@example.com" })).trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email address is required");
  const fetcher = options.fetch ?? fetch;
  const base = (options.authBase ?? KOURIER_AUTH_BASE).replace(/\/$/, "");
  const identityResponse = await fetcher(`${base}/agent/identity`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email }), signal: callbacks.signal,
  });
  if (!identityResponse.ok) throw new Error(`Kourier agent identity request failed (${identityResponse.status})`);
  const identity = await identityResponse.json() as IdentityResponse;
  if (!identity.claim_token || !(identity.verification_url || identity.verification_uri) || !identity.user_code) throw new Error("Kourier returned an incomplete agent identity response");
  const verifyUrl = identity.verification_url ?? identity.verification_uri!;
  callbacks.onAuth({ url: verifyUrl, userCode: identity.user_code, instructions: `Open ${verifyUrl} and enter code ${identity.user_code}` });
  const interval = Math.max(1000, (identity.interval ?? 5) * 1000, options.pollIntervalMs ?? 0);
  const deadline = Date.now() + Math.max(1, identity.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    if (callbacks.signal?.aborted) throw callbacks.signal.reason ?? new Error("Login cancelled");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval);
      callbacks.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(callbacks.signal?.reason ?? new Error("Login cancelled")); }, { once: true });
    });
    const response = await fetcher(`${base}/oauth2/token`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", claim_token: identity.claim_token }), signal: callbacks.signal,
    });
    const payload = await response.json() as TokenResponse;
    if (response.ok && (payload.api_key || payload.access_token)) {
      const key = payload.api_key ?? payload.access_token!;
      callbacks.onProgress?.("Kourier sign-in complete");
      return { apiKey: key, accessToken: key, refreshToken: payload.refresh_token, expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined };
    }
    if (payload.error === "authorization_pending") { callbacks.onProgress?.("Waiting for browser verification…"); continue; }
    if (payload.error === "slow_down") { callbacks.onProgress?.("Kourier requested slower polling"); await new Promise(resolve => setTimeout(resolve, interval)); continue; }
    if (payload.error === "expired_token" || response.status === 404) throw new Error("Kourier sign-in request expired; start login again");
    if (payload.error) throw new Error(`Kourier sign-in failed: ${payload.error_description ?? payload.error}`);
    if (!response.ok) throw new Error(`Kourier token polling failed (${response.status})`);
  }
  throw new Error("Kourier sign-in request expired; start login again");
}
