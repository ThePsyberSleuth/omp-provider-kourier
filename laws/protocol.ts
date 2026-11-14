// Protocol laws for the two loops that used to violate them. Both were refuted by a
// real run (witness kept below) and are proven now that the code re-checks the deadline
// after sleeping and clamps a declared output budget to the context window.
// Each is replayed against the real implementation in tests/.
import {bool, nat, proveRule, rule, when} from 'gdp-wired'

// 1. src/auth/service-auth.ts: the loop re-checks the deadline after the sleep, so a
//    sent poll is always strictly before expiry. Replay: tests/service-auth-deadline.test.ts
//    was refuted by: nowBeforeSleep=0, wait=1, deadline=1 (sent at 1, not < 1).
const poll = rule('service-auth poll loop')
  .params({deadline: nat, wait: nat})
  .inputs({nowBeforeSleep: nat})
  .state({sentAt: 0, sent: 0})
  .assume(({nowBeforeSleep, deadline}) => nowBeforeSleep.lt(deadline))
  .step(({nowBeforeSleep, wait, sentAt, sent, deadline}) => ({
    sentAt: when(sent.eq(0).and(nowBeforeSleep.plus(wait).lt(deadline)), nowBeforeSleep.plus(wait), sentAt),
    sent: when(sent.eq(0).and(nowBeforeSleep.plus(wait).lt(deadline)), 1, sent),
  }))
const inTime = poll.law('a sent poll is still before the deadline', ({sentAt, sent, deadline}) => sent.eq(1).implies(sentAt.lt(deadline)))

// 2. src/discovery/model-catalog.ts: maxTokens is clamped to contextWindow.
//    Replay: tests/catalog-max-tokens.test.ts — was refuted by context=0, declared=1.
const catalog = rule('catalog maxTokens')
  .params({context: nat})
  .inputs({declared: nat})
  .state({accepted: 0})
  .step(({declared, context, accepted}) => ({
    accepted: when(declared.gt(0), when(declared.gt(context), context, declared), accepted),
  }))
const withinContext = catalog.law('a declared budget fits the context window', ({accepted, context}) => accepted.atMost(context))

for (const [name, r, law] of [['poll deadline', poll, inTime], ['catalog budget', catalog, withinContext]] as const) {
  const v = proveRule(r, [law])
  console.log(`${name}: proven=${v.proven} checked=${v.checked}`)
  if (!v.proven) process.exitCode = 1
}
void bool
