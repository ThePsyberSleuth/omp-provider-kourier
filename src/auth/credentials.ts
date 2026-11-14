import type { OAuthCredentials } from "../types.js";

/** The subset of a Kourier token/identity response that carries credentials. */
export interface TokenPayload {
  access_token?: string;
  api_key?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Kourier returns the usable key in either field; `api_key` wins when both appear. */
export function credentialKey(payload: TokenPayload): string | undefined {
  return payload.api_key ?? payload.access_token;
}

/**
 * Build credentials from a token response. `previous` carries a refresh token
 * forward when the server does not rotate it, so a refresh never loses the
 * ability to refresh again.
 */
export function credentialsFromPayload(payload: TokenPayload, previous?: OAuthCredentials): OAuthCredentials {
  const key = credentialKey(payload);
  if (key === undefined) throw new Error("Kourier response did not contain an API key");
  return {
    ...previous,
    access: key,
    refresh: payload.refresh_token ?? previous?.refresh ?? "",
    expires: Date.now() + (payload.expires_in ?? 31536000) * 1000,
  };
}
