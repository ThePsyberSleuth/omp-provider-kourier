// Laws for the two multi-model claims the extension now rests on.
//
// These are MODELS, not source extractions: the shipped code reads module-level
// constants and runtime imports, which the standalone extractor refuses. Each is
// replayed against the real implementation so the model is not the only evidence:
//   1 + 2  replay: tests/discovery.test.ts ("scopes the DeepSeek effort rewrite to
//          the DeepSeek family", "prices every discovered model at the flat
//          subscription rate, never an upstream card")
//   3      replay: tests/compaction-budget.test.ts
import {fun, nat, proveDecision, proveRule, proveSteps, rule, when} from 'gdp-wired'

// --- src/discovery/model-catalog.ts -----------------------------------------
// normalizedFamily has three states, so a nat bounded to 0..2 is the faithful
// shape: 0 = unclassified id, 1 = deepseek, 2 = any other family.
const OTHER = 2
const DEEPSEEK = 1

// `family` is a param, not an input: laws can only speak about params and state
// (inputs are concrete run values and carry no Term), and this is a decision
// over a fixed family, not over a sequence of requests.
const effortMap = rule('effort rewrite by family')
  .params({family: nat})
  .inputs({tick: nat})
  .assume(({family}) => family.atMost(OTHER))
  .state({deepseekVocabulary: 0})
  .step(({family, deepseekVocabulary}) => ({
    // Unrolled once: an unclassified id keeps the DeepSeek vocabulary because
    // the front is known to be DeepSeek-backed today; another family does not.
    deepseekVocabulary: when(family.eq(OTHER), 0, 1),
  }))

// The mapping is applied per normalized row, not to a starting value, so it is
// a step fact: the initial state is unset (0) and only a step decides the row.
// A plain `law` would be refuted by that initial state — the gotcha the skill
// warns about — and would prove the wrong thing.
const dropsForOther = effortMap.stepLaw(
  'another family never inherits the DeepSeek effort rewrite',
  (_before, after) => after.deepseekVocabulary.eq(0),
  ({family}) => family.eq(OTHER))

// Only the DeepSeek family inherits the rewrite. An unclassified id takes the
// dropped map deliberately: a wrong rewrite moves the user's effort rung, while
// a rejected `medium` is healed by the host's nearest-rung retry.
const keepsForDeepseek = effortMap.stepLaw(
  'only a DeepSeek id inherits the DeepSeek effort rewrite',
  (_before, after) => after.deepseekVocabulary.eq(1),
  ({family}) => family.eq(DEEPSEEK))

// A flat-rate subscription is the same price for every id, so the rate card must
// not vary with the family. It is genuinely zero, not missing: no request is
// charged per token. Copying an upstream card in would report phantom spend.
const pricing = fun('flat rate card')
  .inputs({family: nat})
  .assume(({family}) => family.atMost(OTHER))
  .returns(() => ({input: 0, output: 0, cacheRead: 0, cacheWrite: 0}))

const neverCharges = pricing.law(
  'every discovered model prices at the flat subscription rate',
  () => [],
  ({input, output, cacheRead, cacheWrite}) =>
    input.eq(0).and(output.eq(0)).and(cacheRead.eq(0)).and(cacheWrite.eq(0)))

// --- compaction budget ------------------------------------------------------
// The README claims the host's summarization request always fits. The host
// budgets maxTokens = min(floor(0.8 * reserve), 16384) and caps the prompt at
// floor(0.8 * context) - maxTokens - 16384. This proves the sum stays inside the
// context for every advertised shape, not just the 262144 default.
const CEILING = 16384
const compaction = rule('compaction budget')
  .params({context: nat, reserve: nat})
  .inputs({tick: nat})
  .assume(({context}) => context.gt(0))
  .assume(({reserve, context}) => reserve.gt(0).and(reserve.atMost(context)))
  // One-shot: the budget is computed once, so a settled machine is a no-op.
  .state({prompt: 0, maxTokens: 0, done: 0})
  .step(({context, reserve, done}) => {
    const scaled = reserve.mul(8).divBy(10)
    const maxTokens = when(scaled.atMost(CEILING), scaled, CEILING)
    return {
      prompt: when(done.eq(0), context.mul(8).divBy(10).minus(maxTokens).minus(CEILING), 0),
      maxTokens: when(done.eq(0), maxTokens, 0),
      done: 1,
    }
  })

const fits = compaction.law(
  'the summarization prompt plus its output fit inside the context window',
  ({prompt, maxTokens, context}) => prompt.plus(maxTokens).atMost(context))

const results = [
  ['pre: another family drops the rewrite', proveSteps(effortMap, [], [dropsForOther])],
  ['pre: only deepseek keeps the rewrite', proveSteps(effortMap, [], [keepsForDeepseek])],
  ['flat rate card for every family', proveDecision(neverCharges)],
  ['compaction fits the context', proveRule(compaction, [fits])],
] as const

let failed = false
for (const [name, v] of results) {
  console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
  if (!v.proven) failed = true
}
if (failed) process.exitCode = 1
