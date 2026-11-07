import { describe, expect, it } from 'vitest'
import { matchesAppVerifyToken } from './webhook-verify-token'

describe('matchesAppVerifyToken', () => {
  it('matches the configured token', () => {
    expect(matchesAppVerifyToken('meu-token', 'meu-token')).toBe(true)
  })

  it('ignores surrounding blanks in the env value', () => {
    expect(matchesAppVerifyToken('meu-token', '  meu-token\n')).toBe(true)
  })

  it('rejects a different token, including prefixes', () => {
    expect(matchesAppVerifyToken('outro', 'meu-token')).toBe(false)
    expect(matchesAppVerifyToken('meu-toke', 'meu-token')).toBe(false)
  })

  it('never matches when the env is unset or blank', () => {
    expect(matchesAppVerifyToken('anything', undefined)).toBe(false)
    expect(matchesAppVerifyToken('', '')).toBe(false)
    expect(matchesAppVerifyToken('   ', '   ')).toBe(false)
  })

  it('never matches an empty candidate', () => {
    expect(matchesAppVerifyToken('', 'meu-token')).toBe(false)
    expect(matchesAppVerifyToken(null, 'meu-token')).toBe(false)
  })
})
