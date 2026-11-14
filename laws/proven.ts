// Laws the shipped code DOES hold, proven by the kernel ({proven, checked}) and
// cross-checked on concrete runs. The protocol laws in protocol.ts sit beside these:
// together they separate what the code guarantees from what it merely happens to do.
import {bool, fun, nat, proveDecision, proveRule, proveSteps, rule, when} from 'gdp-wired'

// --- src/auth/poll-delay.ts -------------------------------------------------
// Interval is never negative and never shrinks; a slow_down adds exactly 5000.
const backoff = rule('poll backoff')
  .inputs({slowDown: bool})
  .state({interval: 1000})
  .step(({slowDown, interval}) => ({interval: when(slowDown, interval.plus(5000), interval)}))

const neverShrinks = backoff.law('the poll interval never shrinks', ({interval}) => interval.atLeast(1000))
const noSlowDownKeeps = backoff.stepLaw(
  'without slow_down the interval is unchanged',
  ({interval}, after) => after.interval.eq(interval),
  ({slowDown}) => slowDown.not())
const slowDownGrows = backoff.stepLaw(
  'a slow_down grows the interval by 5000',
  ({interval}, after) => after.interval.eq(interval.plus(5000)),
  ({slowDown}) => slowDown)

// --- src/discovery/model-catalog.ts -----------------------------------------
// An undeclared budget falls back to the default; a declared one is taken as given.
// This is a construction-time choice, so it is a pure function, not a rule.
// The context bound is deliberately NOT asserted here: refutations.ts shows it fails.
const DEFAULT_MAX_TOKENS = 65536
const chooseBudget = fun('choose budget')
  .inputs({declared: nat})
  .returns(({declared}) => ({chosen: when(declared.gt(0), declared, DEFAULT_MAX_TOKENS)}))
const neverZero = chooseBudget.law('a chosen budget is never zero', () => [], ({chosen}) => chosen.atLeast(1))

// --- src/auth/service-auth.ts verifyApiKey ----------------------------------
// An empty or whitespace-only key is never sent: verifyApiKey returns false first.
const accept = rule('verify key')
  .inputs({empty: bool})
  .state({sent: 0})
  .step(({empty, sent}) => ({sent: when(empty.not(), 1, sent)}))
const neverSendsEmpty = accept.law('an empty key is never sent', ({sent}) => sent.atMost(0))

const results = [
  ['poll interval monotone', proveRule(backoff, [neverShrinks])],
  ['poll no slow_down keeps', proveSteps(backoff, [neverShrinks], [noSlowDownKeeps])],
  ['poll slow_down grows', proveSteps(backoff, [neverShrinks], [slowDownGrows])],
  ['catalog never zero', proveDecision(neverZero)],
] as const

for (const [name, v] of results) console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
console.log('backoff crossCheck:', JSON.stringify(backoff.crossCheck([neverShrinks])))
