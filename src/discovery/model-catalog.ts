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
// GET /v1/models sends only id/object/created/owned_by — never a context window,
// output limit, or capability block. Those DeepSeek numbers (262,144 / 65,536)
// are verified for the primary model and must not become every id's assumption:
// an over-claimed window makes the host send a prompt past a smaller model's
// real context and take a 400, which is a hard failure, whereas an under-claimed
// one only compacts early and still answers. So an undeclared window falls back
// to a conservative pair that leaves real prompt room (32K - 8K = 24K), and the
// DeepSeek constants apply only to the verified primary id.
const CONSERVATIVE_CONTEXT = 32768;
const CONSERVATIVE_MAX_TOKENS = 8192;
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
  const isPrimary = id === PRIMARY_MODEL;
  // GET /models returns only id/object/created/owned_by, so a missing capability
  // block means "unknown", not "text only": the primary model must keep vision,
  // which the endpoint accepts. An explicit vision:false still wins. Other ids
  // stay text-only until they declare vision — claiming it wrongly costs a 400,
  // while claiming text-only merely swaps images for a placeholder.
  const image = record.capabilities === undefined
    ? isPrimary
    : record.capabilities.vision === true || record.capabilities.input?.includes("image") === true;
  // Undeclared reasoning is only known for the primary model. Defaulting every
  // id to `true` hands it an effort ladder it was never shown to have, and an
  // unsupported effort param is a 400 the user cannot explain.
  const reasoning = record.capabilities?.reasoning ?? isPrimary;
  // An undeclared window is unknown, not DeepSeek-sized: see CONSERVATIVE_*.
  const contextWindow = Number.isSafeInteger(context) && Number(context) > 0
    ? Number(context)
    : (isPrimary ? 262144 : CONSERVATIVE_CONTEXT);
  const declaredOutput = Number.isSafeInteger(output) && Number(output) > 0
    ? Number(output)
    : (isPrimary ? DEFAULT_MAX_TOKENS : CONSERVATIVE_MAX_TOKENS);
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

/**
 * The static entry used when discovery cannot run. Derived from
 * `normalizeModel` rather than hand-written, so the fallback can never drift
 * from what a live `GET /models` would produce for the same id — the two used to
 * be parallel copies that differed only in the display name.
 */
export const FALLBACK_MODELS: ProviderModelConfig[] = [{
  ...normalizeModel({ id: PRIMARY_MODEL })!,
  name: "DeepSeek V4.1 Flash",
}];

export async function discoverModels(apiKey: string, options: { fetch?: FetchLike; baseUrl?: string; signal?: AbortSignal } = {}): Promise<ProviderModelConfig[]> {
  const fetcher = options.fetch ?? fetch;
  const base = (options.baseUrl ?? KOURIER_API_BASE).replace(/\/$/, "");
  const response = await fetcher(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`Kourier model discovery failed (${response.status})`);
  const payload = await response.json() as KourierModelsResponse;
  const models = (Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []).map(normalizeModel).filter((model): model is ProviderModelConfig => model !== undefined);
  return models.length ? models : FALLBACK_MODELS;
}
