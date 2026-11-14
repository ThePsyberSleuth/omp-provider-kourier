// Compares the verify-key model against the REAL verifyApiKey: a blank or CR/LF key
// makes no request, a usable key makes exactly one and sends it sanitized.
import {describe, expect, test} from 'bun:test'
import {verifyApiKey} from '../src/auth/verify-key.js'

function counter() {
  const seen: string[] = []
  const fetchStub = async (_url: string, init: any) => {
    seen.push(init.headers.Authorization)
    return new Response('{}', {status: 200})
  }
  return {seen, fetchStub}
}

describe('verifyApiKey sanitization', () => {
  for (const blank of ['', '   ', '\t\n ']) {
    test(`blank key ${JSON.stringify(blank)} makes no request`, async () => {
      const {seen, fetchStub} = counter()
      expect(await verifyApiKey(blank, {fetch: fetchStub as any})).toBe(false)
      expect(seen).toEqual([])
    })
  }

  test('a key with CR or LF makes no request', async () => {
    const {seen, fetchStub} = counter()
    expect(await verifyApiKey('a\r\nb', {fetch: fetchStub as any})).toBe(false)
    expect(await verifyApiKey('a\nb', {fetch: fetchStub as any})).toBe(false)
    expect(seen).toEqual([])
  })

  test('a usable key makes exactly one request and strips the Bearer prefix', async () => {
    const {seen, fetchStub} = counter()
    expect(await verifyApiKey('  Bearer k-123  ', {fetch: fetchStub as any})).toBe(true)
    expect(seen).toEqual(['Bearer k-123'])
  })
})
