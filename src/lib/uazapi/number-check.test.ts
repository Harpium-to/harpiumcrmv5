import { describe, expect, it } from 'vitest'

import { readNumberCheck } from './api'

describe('readNumberCheck', () => {
  it('reads the yes/no of the first number', () => {
    expect(readNumberCheck([{ query: '5563992085436', isInWhatsapp: true }])).toBe(true)
    expect(readNumberCheck([{ query: '5563992085436', isInWhatsapp: false }])).toBe(false)
    expect(readNumberCheck({ numbers: [{ exists: false }] })).toBe(false)
  })

  it("answers null when it can't tell", () => {
    expect(readNumberCheck(null)).toBeNull()
    expect(readNumberCheck([])).toBeNull()
    expect(readNumberCheck([{ query: 'x' }])).toBeNull()
    expect(readNumberCheck({ error: 'bad token' })).toBeNull()
  })
})
