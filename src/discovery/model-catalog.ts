import { KOURIER_API_BASE, PRIMARY_MODEL, type FetchLike, type KourierModelRecord, type KourierModelsResponse, type ProviderModelConfig } from "../types.js";

// `medium` stays in the ladder only so KOURIER_COMPAT.reasoningEffortMap can
// rewrite it to `high`; the endpoint rejects the literal string.
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
// Kourier's docs claim a 16,384 per-response cap, but the endpoint enforces only
// prompt + max_tokens <= 262144: max_tokens 16385 returns finish_reason "length"
// at exactly 16385, and 40000 completed at 20831. 65536 is DeepSeek's documented
// thinking-mode default and leaves ~196K of prompt room.
const DEFAULT_MAX_TOKENS = 65536;
export const FALLBACK_MODELS: ProviderModelConfig[] = [{
  id: PRIMARY_MODEL, name: "DeepSeek V4.1 Flash", api: "openai-completions", reasoning: true,
  input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262144, maxTokens: DEFAULT_MAX_TOKENS,
  thinking: { mode: "effort", efforts: [...EFFORTS], defaultLevel: "high" },
}];

function normalizeModel(record: KourierModelRecord): ProviderModelConfig | undefined {
  const id = typeof record.id === "string" ? record.id : undefined;
  if (!id || !/^[\w./:-]{1,200}$/.test(id)) return undefined;
  const context = record.context_window ?? record.context_length;
  const output = record.max_output_tokens ?? record.max_tokens;
  // GET /models returns only id/object/created/owned_by, so a missing capability
  // block means "unknown", not "text only": the primary model must keep vision,
  // which the endpoint accepts. An explicit vision:false still wins.
  const image = record.capabilities === undefined
    ? id === PRIMARY_MODEL
    : record.capabilities.vision === true || record.capabilities.input?.includes("image") === true;
  const contextWindow = Number.isSafeInteger(context) && Number(context) > 0 ? Number(context) : 262144;
  const declaredOutput = Number.isSafeInteger(output) && Number(output) > 0 ? Number(output) : DEFAULT_MAX_TOKENS;
  return {
    id, name: typeof record.name === "string" && record.name ? record.name : id,
    api: "openai-completions", reasoning: record.capabilities?.reasoning ?? true,
    input: image ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    // GET /models advertises no output limit; the endpoint's real rule is
    // prompt + max_tokens <= 262144. A declared budget never exceeds the context.
    maxTokens: Math.min(declaredOutput, contextWindow),
    ...(id === PRIMARY_MODEL ? { thinking: { mode: "effort" as const, efforts: [...EFFORTS], defaultLevel: "high" as const } } : {}),
  };
}

export async function discoverModels(apiKey: string, options: { fetch?: FetchLike; baseUrl?: string; signal?: AbortSignal } = {}): Promise<ProviderModelConfig[]> {
  const fetcher = options.fetch ?? fetch;
  const base = (options.baseUrl ?? KOURIER_API_BASE).replace(/\/$/, "");
  const response = await fetcher(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`Kourier model discovery failed (${response.status})`);
  const payload = await response.json() as KourierModelsResponse;
  const models = (Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []).map(normalizeModel).filter((model): model is ProviderModelConfig => model !== undefined);
  return models.length ? models : FALLBACK_MODELS;
}
