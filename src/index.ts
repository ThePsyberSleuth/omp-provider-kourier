import { KOURIER_API_BASE, KOURIER_AUTH_BASE, KOURIER_COMPAT, type ExtensionAPI, type OAuthCredentials, type OAuthLoginCallbacks } from "./types.js";
import { loginWithPkce } from "./auth/pkce-auth.js";
import { loginWithServiceAuth } from "./auth/service-auth.js";
import { verifyApiKey } from "./auth/verify-key.js";
import { refreshToken } from "./auth/refresh.js";
import { discoverModels, FALLBACK_MODELS } from "./discovery/model-catalog.js";

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const method = (await callbacks.onPrompt({ message: "Choose Kourier sign-in: 1) agent email sign-in  2) browser sign-in  3) paste API key", placeholder: "1, 2, or 3" })).trim();
  if (["1", "agent", "email"].includes(method.toLowerCase())) return loginWithServiceAuth(callbacks);
  if (["2", "browser", "pkce"].includes(method.toLowerCase())) return loginWithPkce(callbacks);
  if (["3", "key", "api key", "api-key"].includes(method.toLowerCase())) {
    const key = (await callbacks.onPrompt({ message: "Paste your Kourier API key", placeholder: "sk-bf-…" })).trim().replace(/^Bearer\s+/i, "");
    if (!(await verifyApiKey(key, { signal: callbacks.signal }))) throw new Error("Kourier API key is invalid or could not be verified");
    return { access: key, refresh: "", expires: Date.now() + 31536000 * 1000, apiKey: key, accessToken: key };
  }
  throw new Error("Select 1 (agent), 2 (browser), or 3 (API key)");
}

export default function kourierExtension(pi: ExtensionAPI): void {
  pi.registerProvider("kourier", {
    baseUrl: KOURIER_API_BASE,
    apiKey: "KOURIER_API_KEY",
    api: "openai-completions",
    authHeader: true,
    compat: KOURIER_COMPAT,
    models: FALLBACK_MODELS,
    oauth: {
      name: "Kourier (DeepSeek V4.1 Flash)",
      login,
      getApiKey(credentials) {
        return credentials.access ?? credentials.apiKey ?? credentials.accessToken;
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
