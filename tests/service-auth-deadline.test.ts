// Guards the fix for the deadline counterexample in laws/refutations.ts.
// The shipped loop used to check the deadline before sleeping and send after it, so a
// poll could land at/after expiry. Now the send is skipped once the sleep crossed it.
import {describe, expect, test} from 'bun:test'
import {loginWithServiceAuth} from '../src/auth/service-auth.js'

describe('service-auth deadline', () => {
  test('no token poll is sent at or after the claim expires', async () => {
    const realNow = Date.now
    const realSetTimeout = globalThis.setTimeout
    let now = 1_000_000
    Date.now = () => now
    ;(globalThis as any).setTimeout = (fn: () => void) => { now += 1000; fn(); return 0 }
    try {
      const sendTimes: number[] = []
      const fetchStub = async (url: string) => {
        if (String(url).endsWith('/agent/identity')) {
          return new Response(JSON.stringify({
            claim_token: 'c', user_code: 'U', verification_url: 'https://example.test', interval: 1, expires_in: 1,
          }), {status: 200})
        }
        sendTimes.push(now)
        return new Response(JSON.stringify({error: 'authorization_pending'}), {status: 200})
      }
      const callbacks = {onPrompt: async () => 'me@example.test', onAuth: () => {}, onProgress: () => {}}
      const deadline = 1_000_000 + 1000
      await expect(loginWithServiceAuth(callbacks as any, {fetch: fetchStub as any, authBase: 'https://x.test', pollIntervalMs: 1000}))
        .rejects.toThrow(/expired/)
      expect(sendTimes.filter(t => t >= deadline)).toEqual([])
    } finally {
      Date.now = realNow
      globalThis.setTimeout = realSetTimeout
    }
  })
})
