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

// --- src/auth/verify-key.ts -------------------------------------------------
// verifyApiKey returns false for a blank key before any request, so no request is
// made for one, and a request is made only for a non-blank key.
// Replay: tests/verify-key-sanitize.test.ts
const accept = rule('verify key')
  .inputs({usable: nat})
  .state({requests: 0})
  .assume(({usable}) => usable.atMost(1))
  .step(({usable, requests}) => ({requests: when(usable.eq(1), requests.plus(1), requests)}))
// A blank key makes no request; a usable key makes exactly one.
const neverSendsBlank = accept.stepLaw('a blank key makes no request', ({requests}, after) => after.requests.eq(requests), ({usable}) => usable.eq(0))
const sendsUsable = accept.stepLaw('a usable key makes one request', ({requests}, after) => after.requests.eq(requests.plus(1)), ({usable}) => usable.eq(1))
const monotoneRequests = accept.law('the request count never drops', ({requests}) => requests.atLeast(0))

const results = [
  ['poll interval monotone', proveRule(backoff, [neverShrinks])],
  ['poll no slow_down keeps', proveSteps(backoff, [neverShrinks], [noSlowDownKeeps])],
  ['poll slow_down grows', proveSteps(backoff, [neverShrinks], [slowDownGrows])],
  ['catalog never zero', proveDecision(neverZero)],
  ['verify key blank makes none', proveSteps(accept, [monotoneRequests], [neverSendsBlank])],
  ['verify key usable makes one', proveSteps(accept, [monotoneRequests], [sendsUsable])],
] as const

for (const [name, v] of results) console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
console.log('backoff crossCheck:', JSON.stringify(backoff.crossCheck([neverShrinks])))
