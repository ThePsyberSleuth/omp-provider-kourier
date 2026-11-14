// PKCE callback lifecycle, modelled from src/auth/pkce-auth.ts:27-37.
// One loopback server settles once: a matching state and a code resolves; a state
// mismatch, an error param, or a missing code rejects and never exchanges a token.
// Replay: tests/pkce-state.test.ts
import {nat, oneOf, proveRule, rule, when} from 'gdp-wired'

const callback = rule('pkce callback')
  .inputs({kind: oneOf('state_mismatch', 'error', 'no_code', 'code')})
  // settled: 0 pending, 1 resolved with a code, 2 rejected.
  .state({settled: 0})
  .step(({kind, settled}) => ({
    settled: when(settled.eq(0), when(kind.is('code'), 1, 2), settled),
  }))

// Only a matched state+code resolves.
const resolvesOnCode = callback.stepLaw(
  'a matched state and code resolves',
  (_, after) => after.settled.eq(1),
  ({kind, settled}) => kind.is('code').and(settled.eq(0)))
const mismatchRejects = callback.stepLaw(
  'a state mismatch rejects',
  (_, after) => after.settled.eq(2),
  ({kind, settled}) => kind.is('state_mismatch').and(settled.eq(0)))
const errorRejects = callback.stepLaw(
  'an error param rejects',
  (_, after) => after.settled.eq(2),
  ({kind, settled}) => kind.is('error').and(settled.eq(0)))
const noCodeRejects = callback.stepLaw(
  'a missing code rejects',
  (_, after) => after.settled.eq(2),
  ({kind, settled}) => kind.is('no_code').and(settled.eq(0)))
const settlesOnce = callback.law('settlement is final', ({settled}) => settled.atMost(2))

const results = [
  ['pkce code resolves', proveStepsOf(callback, [settlesOnce], [resolvesOnCode])],
  ['pkce state mismatch rejects', proveStepsOf(callback, [settlesOnce], [mismatchRejects])],
  ['pkce error rejects', proveStepsOf(callback, [settlesOnce], [errorRejects])],
  ['pkce no code rejects', proveStepsOf(callback, [settlesOnce], [noCodeRejects])],
  ['pkce settles at most once', proveRule(callback, [settlesOnce])],
] as const

import {proveSteps as proveStepsOf} from 'gdp-wired'
for (const [name, v] of results) console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
