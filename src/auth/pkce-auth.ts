import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { KOURIER_AUTH_BASE, type FetchLike, type OAuthCredentials, type OAuthLoginCallbacks } from "../types.js";

interface TokenPayload { access_token?: string; api_key?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }

export async function loginWithPkce(callbacks: OAuthLoginCallbacks, options: { fetch?: FetchLike; authBase?: string; clientId?: string; timeoutMs?: number; openBrowser?: (url: string) => Promise<void> } = {}): Promise<OAuthCredentials> {
  const verifier = base64url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = base64url(randomBytes(24));
  const authBase = options.authBase ?? KOURIER_AUTH_BASE;
  const clientId = options.clientId ?? "omp-kourier";
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("Unable to start Kourier loopback callback server"); }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const closeServer = (): void => { server.close(); };
  const timeout = setTimeout(() => reject(new Error("Kourier browser sign-in timed out")), options.timeoutMs ?? 5 * 60_000);
  callbacks.signal?.addEventListener("abort", () => reject(callbacks.signal?.reason ?? new Error("Login cancelled")), { once: true });
  server.on("request", (request, response) => {
    if (request.url?.startsWith("/callback") !== true) { response.writeHead(404).end(); return; }
    const requestUrl = new URL(request.url, redirectUri);
    if (requestUrl.searchParams.get("state") !== state) { response.writeHead(400).end("Invalid state"); reject(new Error("Kourier callback state did not match")); return; }
    const error = requestUrl.searchParams.get("error");
    if (error) { response.writeHead(400).end("Kourier sign-in was not completed"); reject(new Error(`Kourier authorization failed: ${error}`)); return; }
    const code = requestUrl.searchParams.get("code");
    if (!code) { response.writeHead(400).end("Missing authorization code"); reject(new Error("Kourier callback did not include an authorization code")); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end("<!doctype html><title>Kourier connected</title><p>Kourier connected. You may close this window.</p>");
    resolve(code);
  });
  try {
    const authorize = new URL("/oauth2/authorize", authBase);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state }).toString();
    callbacks.onAuth({ url: authorize.toString(), instructions: "Complete sign-in in your browser. This window will close automatically." });
    if (options.openBrowser) await options.openBrowser(authorize.toString());
    const code = await promise;
    const tokenResponse = await (options.fetch ?? fetch)(new URL("/oauth2/token", authBase), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }).toString(), signal: callbacks.signal,
    });
    const payload = await tokenResponse.json() as TokenPayload;
    if (!tokenResponse.ok || !(payload.api_key || payload.access_token)) throw new Error(payload.error_description ?? `Kourier token exchange failed (${tokenResponse.status})`);
    const key = payload.api_key ?? payload.access_token!;
    return { access: key, refresh: payload.refresh_token ?? "", expires: Date.now() + (payload.expires_in ?? 31536000) * 1000 };
  } finally { clearTimeout(timeout); closeServer(); }
}
