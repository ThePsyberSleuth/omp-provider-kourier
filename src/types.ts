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
  OAuthCredentials as SdkOAuthCredentials,
  OAuthLoginCallbacks as SdkOAuthLoginCallbacks,
} from "@oh-my-pi/pi-ai/oauth/types";
import { Effort } from "@oh-my-pi/pi-catalog/effort";

/** Host types, re-exported so the plugin never diverges from the SDK contract. */
export type ProviderModelConfig = SdkProviderModelConfig;
export type ExtensionAPI = SdkExtensionAPI;
export type OAuthCredentials = SdkOAuthCredentials;
export type OAuthLoginCallbacks = SdkOAuthLoginCallbacks;
export { Effort };
/** Kourier (Bifrost) wire quirks, verified against api.kourier.sh. */
export const KOURIER_COMPAT = {
  // The Bifrost schema takes none/minimal/low/medium/high/xhigh/max but DeepSeek
  // rejects the literal "medium" with a 400, so it is rewritten to "high".
  // Measured reasoning tokens: low ~95, high ~113, xhigh ~102 (DeepSeek maps
  // xhigh->high; only "max" ~204 is a real step up). No integer 1-100 support here.
  // (The host also heals this by parsing "must be low, high, xhigh, max" and
  // retrying the nearest rung, so the map is free rather than load-bearing.)
  reasoningEffortMap: { minimal: "low", medium: "high", xhigh: "high" },
  reasoningDisableMode: "none-effort",
  // Thinking streams and replays in `reasoning`, with a parallel
  // `reasoning_details[{type:"reasoning.text"}]` copy. The catalog defaults an
  // openai-completions host to `reasoning_content`, which this wire never sends.
  reasoningContentField: "reasoning",
  supportsReasoningEffort: true,
  supportsReasoningParams: true,
  supportsToolChoice: true,
  supportsForcedToolChoice: true,
  // The model id classifies as the DeepSeek family, so the catalog applies
  // DeepSeek-on-its-own-API rules to this Bifrost front. Measured: every one of
  // them is false here, and leaving them inherited breaks forced tool choice:
  // `disableReasoningOnToolChoice` turns reasoning off whenever a `tool_choice`
  // reaches the policy, which for a forced or named choice also wins over the
  // user's effort. The common agentic case is safe either way — "auto" is
  // deleted before the policy resolves (shouldDropAutoToolChoiceForReasoning),
  // and `disableReasoningWithTools` is not set — so this is about forced/named
  // choices and about replay, not every tools turn.
  disableReasoningOnToolChoice: false,
  requiresReasoningContentForToolCalls: false,
  requiresReasoningContentForAllAssistantTurns: false,
  allowsSyntheticReasoningContentForToolCalls: true,
} as const;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
