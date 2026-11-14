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
export interface ProviderModelConfig {
  id: string; name: string; api: "openai-completions"; reasoning: boolean;
  supportsTools?: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number; maxTokens: number;
  thinking?: { mode: "effort"; efforts: Effort[]; defaultLevel: Effort; requiresEffort?: boolean };
}
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** Kourier (Bifrost) wire quirks, verified against api.kourier.sh. */
export const KOURIER_COMPAT = {
  // DeepSeek rejects effort "medium"; low/high/xhigh/max and "none" are accepted.
  reasoningEffortMap: { minimal: "low", medium: "high" },
  reasoningDisableMode: "none-effort",
  // Thinking streams and replays in `reasoning`, not `reasoning_content`.
  reasoningContentField: "reasoning",
  supportsReasoningEffort: true,
  supportsReasoningParams: true,
  supportsToolChoice: true,
  supportsForcedToolChoice: true,
} as const;
export interface OAuthCredentials {
  access: string; refresh?: string; expires?: number; email?: string;
  apiKey?: string; accessToken?: string; [key: string]: unknown;
}
export interface OAuthAuthInfo { url?: string; instructions?: string; userCode?: string; message?: string }
export interface OAuthPrompt { message: string; placeholder?: string; allowEmpty?: boolean }
export interface OAuthLoginCallbacks {
  onAuth(info: OAuthAuthInfo): void;
  onPrompt(prompt: OAuthPrompt | string): Promise<string>;
  onProgress?(message: string): void;
  signal?: AbortSignal;
}
export interface OAuthProviderConfig {
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string | undefined;
  refreshToken?(credentials: OAuthCredentials): Promise<OAuthCredentials>;
}
export interface ExtensionAPI {
  registerProvider(name: string, config: {
    baseUrl: string; apiKey: string; api: "openai-completions"; authHeader: true;
    compat?: Record<string, unknown>;
    models: ProviderModelConfig[]; oauth: OAuthProviderConfig;
    fetchDynamicModels(apiKey: string): Promise<ProviderModelConfig[]>;
  }): void;
  on?(event: string, handler: (...args: unknown[]) => unknown): void;
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
