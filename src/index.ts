import { KOURIER_API_BASE, KOURIER_AUTH_BASE, type ExtensionAPI, type OAuthCredentials, type OAuthLoginCallbacks } from "./types.js";
import { loginWithPkce } from "./auth/pkce-auth.js";
import { loginWithServiceAuth } from "./auth/service-auth.js";
import { verifyApiKey } from "./auth/verify-key.js";
import { discoverModels, FALLBACK_MODELS } from "./discovery/model-catalog.js";

async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const token = credentials.refreshToken;
  if (typeof token !== "string" || !token) throw new Error("Kourier credentials do not contain a refresh token");
  const response = await fetch(`${KOURIER_AUTH_BASE}/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: token }),
  });
  const payload = await response.json() as { access_token?: string; api_key?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !(payload.api_key || payload.access_token)) throw new Error(payload.error_description ?? `Kourier token refresh failed (${response.status})`);
  const key = payload.api_key ?? payload.access_token!;
  return { ...credentials, apiKey: key, accessToken: key, refreshToken: payload.refresh_token ?? token, expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined };
}

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const method = (await callbacks.onPrompt({ message: "Choose Kourier sign-in: 1) agent email sign-in  2) browser sign-in  3) paste API key", placeholder: "1, 2, or 3" })).trim();
  if (["1", "agent", "email"].includes(method.toLowerCase())) return loginWithServiceAuth(callbacks);
  if (["2", "browser", "pkce"].includes(method.toLowerCase())) return loginWithPkce(callbacks);
  if (["3", "key", "api key", "api-key"].includes(method.toLowerCase())) {
    const key = (await callbacks.onPrompt({ message: "Paste your Kourier API key", placeholder: "sk-bf-…" })).trim().replace(/^Bearer\s+/i, "");
    if (!(await verifyApiKey(key, { signal: callbacks.signal }))) throw new Error("Kourier API key is invalid or could not be verified");
    return { apiKey: key, accessToken: key };
  }
  throw new Error("Select 1 (agent), 2 (browser), or 3 (API key)");
}

export default function kourierExtension(pi: ExtensionAPI): void {
  pi.registerProvider("kourier", {
    baseUrl: KOURIER_API_BASE,
    apiKey: "KOURIER_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: FALLBACK_MODELS,
    oauth: {
      name: "Kourier (DeepSeek V4.1 Flash)",
      login,
      getApiKey(credentials) {
        const key = credentials.apiKey ?? credentials.accessToken;
        return typeof key === "string" ? key : undefined;
      },
      refreshToken,
    },
    async fetchDynamicModels(apiKey) {
      if (!apiKey) return FALLBACK_MODELS;
      try { return await discoverModels(apiKey); }
      catch { return FALLBACK_MODELS; }
    },
  });
}
