import { describe, expect, test } from "bun:test";
import { loginWithPkce } from "../src/auth/pkce-auth.js";
import kourierExtension from "../src/index.js";
import type { ExtensionAPI, OAuthLoginCallbacks } from "../src/types.js";

const callbacks: OAuthLoginCallbacks = { onAuth() {}, onPrompt: async () => "", onProgress() {} };

describe("Kourier PKCE and extension", () => {
  test("runs an S256 browser callback and exchanges the authorization code", async () => {
    let tokenBody: Record<string, unknown> | undefined;
    const result = await loginWithPkce(callbacks, {
      authBase: "https://auth.example", clientId: "test-client",
      openBrowser: async url => {
        const authorize = new URL(url);
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
        const callback = new URL(String(authorize.searchParams.get("redirect_uri")) + "/callback");
        callback.searchParams.set("state", String(authorize.searchParams.get("state")));
        callback.searchParams.set("code", "test-code");
        const response = await fetch(callback);
        expect(response.ok).toBe(true);
      },
      fetch: async (input, init) => {
        expect(String(input)).toBe("https://auth.example/oauth2/token");
        tokenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ access_token: "sk-bf-token", refresh_token: "refresh", expires_in: 3600 });
      },
    });
    expect(result.apiKey).toBe("sk-bf-token");
    expect(tokenBody).toMatchObject({ grant_type: "authorization_code", code: "test-code", client_id: "test-client" });
    expect(typeof tokenBody?.code_verifier).toBe("string");
  });
  test("registers provider defaults, OAuth, and dynamic discovery", async () => {
    let providerName = "";
    let configuration: Parameters<ExtensionAPI["registerProvider"]>[1] | undefined;
    const api: ExtensionAPI = { registerProvider(name, config) { providerName = name; configuration = config; } };
    kourierExtension(api);
    expect(providerName).toBe("kourier");
    expect(configuration?.api).toBe("openai-completions");
    expect(configuration?.baseUrl).toBe("https://api.kourier.sh/v1");
    expect(configuration?.oauth.name).toBe("Kourier (DeepSeek V4.1 Flash)");
    expect(configuration?.models[0]?.id).toBe("deepseek-v4.1-flash");
  });
});
