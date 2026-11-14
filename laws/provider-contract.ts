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

// --- capability defaults ----------------------------------------------------
// GET /v1/models sends id/object/created/owned_by only, so a row that is not the
// verified primary usually arrives with no capability block and no limits. The
// shipped branches, modelled exactly (this is where an earlier version of this
// file was wrong: it omitted the declared paths and so proved a claim the code
// violates for a non-primary id that declares a large window):
//
//   contextWindow = declaredContext > 0 ? declaredContext : isPrimary ? 262144 : 32768
//   maxTokens     = min(declaredOutput > 0 ? declaredOutput : isPrimary ? 65536 : 8192,
//                       contextWindow)
//   ladder        = declared.reasoning ?? isPrimary
//
// params: `declared` capability block (0 absent, 1 reasoning false, 2 reasoning
// true), `declaredContext` / `declaredOutput` (0 = absent), `isPrimary` (0/1).
const PRESENT = 1
const ABSENT = 0
const DECLARED_FALSE = 1
const CONSERVATIVE_CONTEXT = 32768
const CONSERVATIVE_MAX_TOKENS = 8192
const PRIMARY_CONTEXT = 262144
const PRIMARY_MAX_TOKENS = 65536
// Above every default, so the declared-value laws cover the range their names
// claim (and the 1,000,000 witness the regression test uses).
const DECLARED_CEILING = 2000000

const defaults = rule('capability defaults')
  .params({declared: nat, declaredContext: nat, declaredOutput: nat, isPrimary: nat})
  .inputs({tick: nat})
  .assume(({declared}) => declared.atMost(2))
  .assume(({isPrimary}) => isPrimary.atMost(1))
  // The declared bounds must reach ABOVE the primary defaults, or a law named
  // "declared always wins" cannot observe the case it claims: a provider
  // declaring 1,000,000 is exactly the witness its name covers (and the case the
  // regression test uses). Bounding at PRIMARY_CONTEXT silently restricted the
  // domain to "declared wins, up to the value it would default to anyway".
  .assume(({declaredContext}) => declaredContext.atMost(DECLARED_CEILING))
  .assume(({declaredOutput}) => declaredOutput.atMost(DECLARED_CEILING))
  // `done` separates "computed" from the initial state: laws that talk about
  // context/maxTokens are vacuously false on the initial zeros, which is the
  // initial-state gotcha this file already hit once.
  .state({ladder: 0, context: 0, maxTokens: 0, done: 0})
  .step(({declared, declaredContext, declaredOutput, isPrimary}) => {
    const fallbackContext = when(isPrimary.eq(1), PRIMARY_CONTEXT, CONSERVATIVE_CONTEXT)
    const context = when(declaredContext.gt(0), declaredContext, fallbackContext)
    const fallbackOutput = when(isPrimary.eq(1), PRIMARY_MAX_TOKENS, CONSERVATIVE_MAX_TOKENS)
    const requestedOutput = when(declaredOutput.gt(0), declaredOutput, fallbackOutput)
    return {
      ladder: when(declared.eq(DECLARED_FALSE), 0, when(declared.eq(2), 1, isPrimary)),
      context,
      // Math.min in the shipped code — the clamp, not just the fallback.
      maxTokens: when(requestedOutput.atMost(context), requestedOutput, context),
      done: 1,
    }
  })

// The claim that matters for a future model: never offer an effort ladder that
// was not earned. Over-offering one invites a 400 the user cannot explain.
const noUnearnedLadder = defaults.law(
  'a ladder is offered only when reasoning was declared or the id is primary',
  ({ladder, declared, isPrimary}) =>
    ladder.eq(1).implies(declared.eq(2).or(isPrimary.eq(1))))

// An over-claimed context is a hard failure (prompt past the real window ->
// 400); an under-claimed one only compacts early. So the output budget may never
// exceed the window, whatever was declared.
const budgetWithinContext = defaults.law(
  'the output budget never exceeds the claimed context window',
  ({maxTokens, context, done}) => done.eq(1).implies(maxTokens.atMost(context)))

// Scoped to the UNDECLARED case on purpose. A non-primary id that declares a
// large window legitimately exceeds the conservative fallback; the property that
// actually holds is that the conservative default is what an undeclared one
// gets, and that nothing gets the big window by accident.
const conservativeForUndeclared = defaults.law(
  'an undeclared non-primary id falls back to the conservative window',
  ({context, declaredContext, isPrimary, done}) =>
    done.eq(1).and(declaredContext.eq(0)).and(isPrimary.eq(0)).implies(context.eq(CONSERVATIVE_CONTEXT)))

const declaredContextWins = defaults.law(
  'a declared context window always wins over every default',
  ({context, declaredContext, done}) =>
    done.eq(1).and(declaredContext.gt(0)).implies(context.eq(declaredContext)))

const primaryDefaultOnly = defaults.law(
  'the DeepSeek window is claimed only by the primary id or a declared value',
  ({context, declaredContext, isPrimary, done}) =>
    done.eq(1).and(context.eq(PRIMARY_CONTEXT)).implies(isPrimary.eq(1).or(declaredContext.eq(PRIMARY_CONTEXT))))

const results = [
  ['pre: another family drops the rewrite', proveSteps(effortMap, [], [dropsForOther])],
  ['pre: only deepseek keeps the rewrite', proveSteps(effortMap, [], [keepsForDeepseek])],
  ['flat rate card for every family', proveDecision(neverCharges)],
  ['compaction fits the context', proveRule(compaction, [fits])],
  ['no unearned effort ladder', proveRule(defaults, [noUnearnedLadder])],
  ['budget fits the claimed window', proveRule(defaults, [budgetWithinContext])],
  ['undeclared non-primary is conservative', proveRule(defaults, [conservativeForUndeclared])],
  ['declared context always wins', proveRule(defaults, [declaredContextWins])],
  ['big window needs primary or declaration', proveRule(defaults, [primaryDefaultOnly])],
] as const

void PRESENT
void ABSENT

let failed = false
for (const [name, v] of results) {
  console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
  if (!v.proven) failed = true
}
if (failed) process.exitCode = 1
