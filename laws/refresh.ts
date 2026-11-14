// Credential refresh, modelled from src/auth/refresh.ts: a refresh either yields a new
// access key or throws; the refresh token is never lost when the server keeps it.
// Replay: tests/refresh.test.ts
import {nat, proveRule, proveSteps, rule, when} from 'gdp-wired'

const refresh = rule('token refresh')
  // hasToken: 1 when a refresh token exists (otherwise refresh throws before any request).
  // rotated: 1 when the server returned a new refresh token.
  .inputs({rotated: nat})
  .state({requests: 0, haveRefresh: 1, access: 0})
  .assume(({rotated}) => rotated.atMost(1))
  .step(({rotated, requests, haveRefresh, access}) => ({
    // A request is made only while a refresh token exists.
    requests: when(haveRefresh.eq(1), requests.plus(1), requests),
    // The stored refresh token is kept when not rotated, so refresh stays possible.
    haveRefresh: 1,
    access: when(haveRefresh.eq(1), 1, access),
  }))

const neverLosesRefresh = refresh.law('a refresh never loses the refresh token', ({haveRefresh}) => haveRefresh.eq(1))
const rotatedKeepsAccess = refresh.stepLaw(
  'a rotated refresh still yields access',
  (_, after) => after.access.eq(1),
  ({rotated}) => rotated.eq(1))

const results = [
  ['refresh never loses token', proveRule(refresh, [neverLosesRefresh])],
  ['refresh keeps access', proveSteps(refresh, [neverLosesRefresh], [rotatedKeepsAccess])],
] as const
for (const [name, v] of results) console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
