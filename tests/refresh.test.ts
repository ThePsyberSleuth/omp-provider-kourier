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
})
