// Guards the fix for the catalog counterexample in laws/refutations.ts.
// discoverModels used to accept any declared output budget, even one exceeding the
// context window; now the budget is clamped to it.
import {describe, expect, test} from 'bun:test'
import {discoverModels} from '../src/discovery/model-catalog.js'

describe('catalog maxTokens', () => {
  test('a declared output budget never exceeds the context window', async () => {
    const fetchStub = async () => new Response(JSON.stringify({
      data: [{id: 'deepseek-v4.1-flash', context_window: 4096, max_output_tokens: 65536}],
    }), {status: 200})
    const models = await discoverModels('k', {fetch: fetchStub as any, baseUrl: 'https://x.test'})
    expect(models).toHaveLength(1)
    expect(models[0]!.contextWindow).toBe(4096)
    expect(models[0]!.maxTokens).toBe(4096)
  })

  test('an undeclared budget still falls back to the default', async () => {
    const fetchStub = async () => new Response(JSON.stringify({
      data: [{id: 'deepseek-v4.1-flash', context_window: 262144}],
    }), {status: 200})
    const models = await discoverModels('k', {fetch: fetchStub as any, baseUrl: 'https://x.test'})
    expect(models[0]!.maxTokens).toBe(65536)
  })
})
