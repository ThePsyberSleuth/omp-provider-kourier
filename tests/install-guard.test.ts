// Compares the install-guard model against the REAL installBlocker over every input:
// three booleans and force give 16 combinations, so enumeration is exhaustive here
// rather than a sampled search. The laws are the ones stated in src/install-guard.ts.
import {describe, expect, test} from 'bun:test'
import {installBlocker} from '../src/install-guard.js'

const bools = [false, true]
const space = bools.flatMap(marketplace =>
  bools.flatMap(extension =>
    bools.flatMap(isDirectory => bools.map(force => ({exists: {marketplace, extension, isDirectory}, force})))))
// Model: same decision written independently as the intended rule.
function model({exists, force}: {exists: {marketplace: boolean; extension: boolean; isDirectory: boolean}; force: boolean}) {
  if (exists.marketplace && !force) return 'marketplace'
  if (exists.extension && exists.isDirectory) return 'directory'
  if (exists.extension && !force) return 'existing'
  return undefined
}

describe('installBlocker', () => {
  test('covers all 16 inputs', () => expect(space).toHaveLength(16))

  test('matches the model on every input', () => {
    for (const input of space) expect(installBlocker(input.exists, input.force)).toBe(model(input))
  })

  test('force never blocks a marketplace or existing install', () => {
    for (const input of space.filter(i => i.force)) {
      const result = installBlocker(input.exists, input.force)
      expect(result).not.toBe('marketplace')
      expect(result).not.toBe('existing')
    }
  })

  test('an extension directory is refused whatever force says', () => {
    for (const input of space) {
      if (installBlocker(input.exists, input.force) === 'directory') {
        expect(input.exists.extension && input.exists.isDirectory).toBe(true)
      }
    }
  })

  test('a marketplace plugin blocks only without force', () => {
    for (const input of space.filter(i => i.exists.marketplace && !i.force)) {
      expect(installBlocker(input.exists, input.force)).toBe('marketplace')
    }
    for (const input of space.filter(i => i.force)) {
      expect(installBlocker(input.exists, input.force)).not.toBe('marketplace')
    }
  })
})
