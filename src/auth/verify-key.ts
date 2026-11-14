import { KOURIER_API_BASE, type FetchLike } from "../types.js";

/**
 * A pasted key may carry a `Bearer ` prefix or surrounding whitespace. Used by
 * every entry point that accepts one, so the three call sites cannot diverge.
 */
export function normalizeApiKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, "");
}

export async function verifyApiKey(key: string, options: { fetch?: FetchLike; baseUrl?: string; signal?: AbortSignal } = {}): Promise<boolean> {
  const candidate = normalizeApiKey(key);
  if (!candidate || /[\r\n]/.test(candidate)) return false;
  try {
    const response = await (options.fetch ?? fetch)(`${(options.baseUrl ?? KOURIER_API_BASE).replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${candidate}`, Accept: "application/json" }, signal: options.signal,
    });
    return response.ok;
  } catch { return false; }
}
