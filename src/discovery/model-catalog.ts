import { classifyModel } from "@oh-my-pi/pi-catalog";
import { Effort, KOURIER_API_BASE, KOURIER_COMPAT, PRIMARY_MODEL, type FetchLike, type KourierModelRecord, type KourierModelsResponse, type ProviderModelConfig } from "../types.js";

// `medium` stays in the ladder only so KOURIER_COMPAT.reasoningEffortMap can
// rewrite it to `high`; the endpoint rejects the literal string.
const EFFORTS = [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, Effort.Max] as const;
const THINKING = { mode: "effort" as const, efforts: EFFORTS, defaultLevel: Effort.High };
// Kourier's docs claim a 16,384 per-response cap, but the endpoint enforces only
// prompt + max_tokens <= 262144: max_tokens 16385 returns finish_reason "length"
// at exactly 16385, and 40000 completed at 20831. 65536 is DeepSeek's documented
// thinking-mode default and leaves ~196K of prompt room.
const DEFAULT_MAX_TOKENS = 65536;
// Kourier sells the whole catalog as a flat subscription — "no request-volume or
// token-usage quotas" (Starter $20/mo, Pro $50/mo, per kourier.sh/pricing). The
// per-token rate card is therefore genuinely zero here, not missing: billing is
// the subscription, and no request is charged per token. Do NOT copy an upstream
// provider's rate card in (DeepSeek's is 0.3/1.2): that reports spend the user
// never incurred, and it would be wrong for every future family anyway.
const COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
// Families whose effort vocabulary is NOT Kourier's. `medium` is rewritten to
// `high` because DeepSeek 400s on the literal, which is a DeepSeek fact served
// through a Bifrost front — not a property of the subscription. Applying that
// rewrite to a future non-DeepSeek id would silently move its effort level.
const DEEPSEEK_FAMILY = "deepseek";
export const FALLBACK_MODELS: ProviderModelConfig[] = [{
  id: PRIMARY_MODEL, name: "DeepSeek V4.1 Flash", api: "openai-completions", reasoning: true,
  input: ["text", "image"], cost: { ...COST },
  contextWindow: 262144, maxTokens: DEFAULT_MAX_TOKENS,
  thinking: THINKING,
  compat: KOURIER_COMPAT,
}];

/** Identity a model id resolves to in the bundled catalog, best-effort. */
function familyOf(id: string): string | undefined {
  try { return classifyModel("kourier", id, { lenient: true }).class; }
  catch { return undefined; }
}

function normalizeModel(record: KourierModelRecord): ProviderModelConfig | undefined {
  const id = typeof record.id === "string" ? record.id : undefined;
  if (!id || !/^[\w./:-]{1,200}$/.test(id)) return undefined;
  const context = record.context_window ?? record.context_length;
  const output = record.max_output_tokens ?? record.max_tokens;
  const family = familyOf(id);
  // GET /models returns only id/object/created/owned_by, so a missing capability
  // block means "unknown", not "text only": the primary model must keep vision,
  // which the endpoint accepts. An explicit vision:false still wins. Other ids
  // stay text-only until they declare vision — claiming it wrongly costs a 400,
  // while claiming text-only merely swaps images for a placeholder.
  const image = record.capabilities === undefined
    ? id === PRIMARY_MODEL
    : record.capabilities.vision === true || record.capabilities.input?.includes("image") === true;
  const reasoning = record.capabilities?.reasoning ?? true;
  const contextWindow = Number.isSafeInteger(context) && Number(context) > 0 ? Number(context) : 262144;
  const declaredOutput = Number.isSafeInteger(output) && Number(output) > 0 ? Number(output) : DEFAULT_MAX_TOKENS;
  // The wire quirks that are properties of the Bifrost front apply to every id.
  // The effort rewrite is family-specific, so only a DeepSeek id inherits it.
  // An unclassified id ('unknown') is treated as not-DeepSeek on purpose: a
  // wrong rewrite silently moves the user's effort rung, whereas a `medium` a
  // future non-DeepSeek backend rejects is healed by the host, which parses
  // "must be low, high, xhigh, max" and retries the nearest rung.
  const { reasoningEffortMap, ...wireCompat } = KOURIER_COMPAT;
  const compat = family === DEEPSEEK_FAMILY
    ? KOURIER_COMPAT
    : { ...wireCompat, reasoningEffortMap: { minimal: "low" as const } };
  return {
    id, name: typeof record.name === "string" && record.name ? record.name : id,
    api: "openai-completions", reasoning,
    input: image ? ["text", "image"] : ["text"],
    cost: { ...COST },
    contextWindow,
    // GET /models advertises no output limit; the endpoint's real rule is
    // prompt + max_tokens <= 262144. A declared budget never exceeds the context.
    maxTokens: Math.min(declaredOutput, contextWindow),
    // The wire, not the model, owns these: every id is served by the same
    // Bifrost front, so a bare `medium` 400s and reasoning streams in
    // `reasoning` for all of them. `thinking` gates on the reasoning flag so a
    // non-reasoning row is not offered an effort ladder it cannot honour.
    compat,
    ...(reasoning ? { thinking: THINKING } : {}),
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
