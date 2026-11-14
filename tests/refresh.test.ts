// Compares the refresh model (laws/refresh.ts) against the REAL refreshToken:
// a rotated token replaces the old one, an unrotated one is kept, and no token throws
// before any request.
import {afterEach, describe, expect, test} from 'bun:test'
import {refreshToken} from '../src/auth/refresh.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function stub(payload: unknown, ok = true) {
  const bodies: unknown[] = []
  globalThis.fetch = (async (_url: string, init: any) => {
    bodies.push(JSON.parse(String(init.body)))
    return Response.json(payload, {status: ok ? 200 : 400})
  }) as any
  return bodies
}

const credentials = {access: 'old', refresh: 'r1', expires: 0}

describe('refreshToken', () => {
  test('no refresh token throws before any request', async () => {
    const bodies = stub({})
    await expect(refreshToken({...credentials, refresh: ''})).rejects.toThrow(/do not contain a refresh token/)
    expect(bodies).toEqual([])
  })

  test('a rotated refresh token replaces the old one', async () => {
    stub({access_token: 'new', refresh_token: 'r2', expires_in: 60})
    const next = await refreshToken(credentials)
    expect(next).toMatchObject({access: 'new', refresh: 'r2'})
  })

  test('an unrotated refresh token is kept', async () => {
    stub({access_token: 'new'})
    const next = await refreshToken(credentials)
    expect(next.refresh).toBe('r1')
  })

  test('a failed refresh throws and does not return credentials', async () => {
    stub({error_description: 'nope'}, false)
    await expect(refreshToken(credentials)).rejects.toThrow(/nope/)
  })

  // A 200 carrying an empty key is a failed exchange, not credentials with no
  // key: the guard is truthiness, so `{"api_key": ""}` must throw rather than
  // hand back `access: ""` (which would look like a valid login). Driven through
  // the real refreshToken, not the helper, so the contract is pinned where it
  // is actually relied on. The message differs by layer (refreshToken rejects on
  // its own status check before credentials are built), so assert the rejection.
  test('an empty key in a 200 is rejected, not accepted as credentials', async () => {
    for (const payload of [{api_key: ''}, {access_token: ''}, {}]) {
      stub(payload)
      await expect(refreshToken(credentials)).rejects.toThrow(/did not contain an API key|token refresh failed/)
    }
  })

  test('an empty api_key falls through to a usable access_token', async () => {
    stub({api_key: '', access_token: 'real'})
    const next = await refreshToken(credentials)
    expect(next.access).toBe('real')
  })
})
