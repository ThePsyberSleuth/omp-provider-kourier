import { KOURIER_API_BASE, type FetchLike } from "../types.js";

export async function verifyApiKey(key: string, options: { fetch?: FetchLike; baseUrl?: string; signal?: AbortSignal } = {}): Promise<boolean> {
  const candidate = key.trim().replace(/^Bearer\s+/i, "");
  if (!candidate || /[\r\n]/.test(candidate)) return false;
  try {
    const response = await (options.fetch ?? fetch)(`${(options.baseUrl ?? KOURIER_API_BASE).replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${candidate}`, Accept: "application/json" }, signal: options.signal,
    });
    return response.ok;
  } catch { return false; }
}
