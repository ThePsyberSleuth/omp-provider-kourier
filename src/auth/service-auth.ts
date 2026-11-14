import { KOURIER_AUTH_BASE, type FetchLike, type OAuthCredentials, type OAuthLoginCallbacks } from "../types.js";
import { nextPollDelay } from "./poll-delay.js";
import { credentialsFromPayload, credentialKey, type TokenPayload } from "./credentials.js";

export { nextPollDelay };

interface IdentityClaim { user_code?: string; verification_uri?: string; verification_url?: string; interval?: number; expires_in?: number }
interface IdentityResponse {
  claim_token?: string;
  user_code?: string;
  verification_uri?: string;
  verification_url?: string;
  interval?: number;
  expires_in?: number;
  claim?: IdentityClaim;
}

async function parseTokenResponse(response: Response): Promise<TokenPayload> {
  const body = await response.text();
  try { return JSON.parse(body) as TokenPayload; }
  catch {
    const fields = new URLSearchParams(body);
    return {
      access_token: fields.get("access_token") ?? undefined,
      api_key: fields.get("api_key") ?? undefined,
      refresh_token: fields.get("refresh_token") ?? undefined,
      error: fields.get("error") ?? undefined,
      error_description: fields.get("error_description") ?? undefined,
      expires_in: Number(fields.get("expires_in")) || undefined,
    };
  }
}

function waitForPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, milliseconds);
  if (signal) {
    const cancel = (): void => { clearTimeout(timer); reject(signal.reason ?? new Error("Login cancelled")); };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  }
  return promise;
}

export async function loginWithServiceAuth(callbacks: OAuthLoginCallbacks, options: { fetch?: FetchLike; authBase?: string; pollIntervalMs?: number } = {}): Promise<OAuthCredentials> {
  const email = (await callbacks.onPrompt({ message: "Email address for Kourier agent sign-in", placeholder: "you@example.com" })).trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email address is required");
  const fetcher = options.fetch ?? fetch;
  const base = (options.authBase ?? KOURIER_AUTH_BASE).replace(/\/$/, "");
  const identityResponse = await fetcher(`${base}/agent/identity`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ type: "service_auth", login_hint: email, client_name: "omp" }), signal: callbacks.signal,
  });
  if (!identityResponse.ok) throw new Error(`Kourier agent identity request failed (${identityResponse.status})`);
  const identity = await identityResponse.json() as IdentityResponse;
  const claim = identity.claim;
  const claimToken = identity.claim_token;
  const userCode = claim?.user_code ?? identity.user_code;
  const verifyUrl = claim?.verification_url ?? identity.verification_url ?? claim?.verification_uri ?? identity.verification_uri;
  if (!claimToken || !verifyUrl || !userCode) throw new Error("Kourier returned an incomplete agent identity response");
  callbacks.onAuth({ url: verifyUrl, instructions: `Code: ${userCode}\nOpen ${verifyUrl} in your browser, sign in with ${email}, type the code and click Approve.` });
  const intervalSeconds = claim?.interval ?? identity.interval ?? 5;
  let intervalMs = Math.max(1000, intervalSeconds * 1000, options.pollIntervalMs ?? 0);
  const expiresIn = claim?.expires_in ?? identity.expires_in ?? 600;
  const deadline = Date.now() + Math.max(1, expiresIn) * 1000;
  while (Date.now() < deadline) {
    if (callbacks.signal?.aborted) throw callbacks.signal.reason ?? new Error("Login cancelled");
    await waitForPoll(intervalMs, callbacks.signal);
    // The check above happens before the sleep; re-check so a poll is never sent at/after expiry.
    if (Date.now() >= deadline) break;
    const response = await fetcher(`${base}/oauth2/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:workos:agent-auth:grant-type:claim", claim_token: claimToken }).toString(), signal: callbacks.signal,
    });
    const payload = await parseTokenResponse(response);
    if (response.ok && credentialKey(payload) !== undefined) {
      callbacks.onProgress?.("Kourier sign-in complete");
      return { ...credentialsFromPayload(payload), email };
    }
    if (payload.error === "authorization_pending") { callbacks.onProgress?.("Waiting for browser verification…"); continue; }
    if (payload.error === "slow_down") {
      intervalMs = nextPollDelay(intervalMs, true);
      callbacks.onProgress?.("Kourier requested slower polling"); continue;
    }
    if (payload.error === "expired_token" || response.status === 404) throw new Error("Kourier sign-in request expired; start login again");
    if (payload.error) throw new Error(`Kourier sign-in failed: ${payload.error_description ?? payload.error}`);
    if (!response.ok) throw new Error(`Kourier token polling failed (${response.status})`);
  }
  throw new Error("Kourier sign-in request expired; start login again");
}
