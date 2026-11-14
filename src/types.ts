export const KOURIER_API_BASE = "https://api.kourier.sh/v1";
export const KOURIER_AUTH_BASE = "https://app.kourier.sh";
export const PRIMARY_MODEL = "deepseek-v4.1-flash";

export interface KourierModelRecord {
  id?: string; name?: string; context_length?: number; context_window?: number;
  max_output_tokens?: number; max_tokens?: number;
  capabilities?: { reasoning?: boolean; vision?: boolean; input?: string[] };
  [key: string]: unknown;
}
export interface KourierModelsResponse { data?: KourierModelRecord[]; models?: KourierModelRecord[] }
import type { ExtensionAPI as SdkExtensionAPI, ProviderModelConfig as SdkProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import type {
  OAuthAuthInfo as SdkOAuthAuthInfo,
  OAuthCredentials as SdkOAuthCredentials,
  OAuthLoginCallbacks as SdkOAuthLoginCallbacks,
  OAuthPrompt as SdkOAuthPrompt,
} from "@oh-my-pi/pi-ai/oauth/types";
import { Effort } from "@oh-my-pi/pi-catalog/effort";

/** Host types, re-exported so the plugin never diverges from the SDK contract. */
export type ProviderModelConfig = SdkProviderModelConfig;
export type ExtensionAPI = SdkExtensionAPI;
export type OAuthCredentials = SdkOAuthCredentials;
export type OAuthLoginCallbacks = SdkOAuthLoginCallbacks;
export type OAuthAuthInfo = SdkOAuthAuthInfo;
export type OAuthPrompt = SdkOAuthPrompt;
export { Effort };
/** The efforts Kourier's wire accepts, as the host's enum. */
export const KOURIER_EFFORTS = [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, Effort.Max] as const;
/** Kourier (Bifrost) wire quirks, verified against api.kourier.sh. */
export const KOURIER_COMPAT = {
  // The Bifrost schema takes none/minimal/low/medium/high/xhigh/max but DeepSeek
  // rejects the literal "medium" with a 400, so it is rewritten to "high".
  // Measured reasoning tokens: low ~95, high ~113, xhigh ~102 (DeepSeek maps
  // xhigh->high; only "max" ~204 is a real step up). No integer 1-100 support here.
  reasoningEffortMap: { minimal: "low", medium: "high", xhigh: "high" },
  reasoningDisableMode: "none-effort",
  // Thinking streams and replays in `reasoning`, not `reasoning_content`.
  reasoningContentField: "reasoning",
  supportsReasoningEffort: true,
  supportsReasoningParams: true,
  supportsToolChoice: true,
  supportsForcedToolChoice: true,
} as const;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
