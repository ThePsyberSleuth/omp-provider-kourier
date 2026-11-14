// Compares the PKCE model (laws/pkce.ts) against the REAL loginWithPkce loopback
// callback: a state mismatch, an error param, and a missing code each reject without
// exchanging a token; a matched state and code resolves exactly once.
import {describe, expect, test} from 'bun:test'
import {loginWithPkce} from '../src/auth/pkce-auth.js'

const callbacks = {onAuth() {}, onPrompt: async () => '', onProgress() {}}

// `mutate` edits the callback the browser would hit, given the authorize URL's state.
function login(mutate: (callback: URL, state: string) => void, onToken?: () => void) {
  return loginWithPkce(callbacks, {
    authBase: 'https://auth.example',
    clientId: 'test-client',
    openBrowser: async url => {
      const authorize = new URL(url)
      const state = String(authorize.searchParams.get('state'))
      const callback = new URL(String(authorize.searchParams.get('redirect_uri')))
      mutate(callback, state)
      // Fire-and-forget: the reply settles the login promise; the assertion awaits it.
      void fetch(callback).catch(() => {})
    },
    fetch: async () => {
      onToken?.()
      return Response.json({access_token: 'sk', refresh_token: 'r', expires_in: 60})
    },
  })
}

describe('PKCE callback settlement', () => {
  test('a state mismatch rejects and never exchanges a token', async () => {
    let tokens = 0
    await expect(login((u) => { u.searchParams.set('state', 'wrong'); u.searchParams.set('code', 'c') }, () => { tokens++ }))
      .rejects.toThrow(/state did not match/)
    expect(tokens).toBe(0)
  })

  test('an error param rejects and never exchanges a token', async () => {
    let tokens = 0
    await expect(login((u, state) => { u.searchParams.set('state', state); u.searchParams.set('error', 'access_denied') }, () => { tokens++ }))
      .rejects.toThrow(/authorization failed/)
    expect(tokens).toBe(0)
  })

  test('a missing code rejects and never exchanges a token', async () => {
    let tokens = 0
    await expect(login((u, state) => { u.searchParams.set('state', state) }, () => { tokens++ }))
      .rejects.toThrow(/did not include an authorization code/)
    expect(tokens).toBe(0)
  })

  test('a matched state and code resolves once', async () => {
    await expect(login((u, state) => { u.searchParams.set('state', state); u.searchParams.set('code', 'good') }))
      .resolves.toMatchObject({access: 'sk'})
  })
})
