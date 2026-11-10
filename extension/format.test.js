import { describe, expect, it } from 'vitest'

import { addTagName, formatWhen, parseMoney } from './format.js'

describe('parseMoney', () => {
  it('reads the amount the way it is typed in Brazil', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56)
    expect(parseMoney('1234,56')).toBe(1234.56)
    expect(parseMoney('R$ 4.800')).toBe(4800)
    expect(parseMoney('4.800')).toBe(4800)
    expect(parseMoney('1.234.567')).toBe(1234567)
    expect(parseMoney('4800')).toBe(4800)
    expect(parseMoney(' 12,5 ')).toBe(12.5)
  })

  it('reads a dot as a decimal when it cannot be thousands', () => {
    expect(parseMoney('1234.56')).toBe(1234.56)
    expect(parseMoney('12.5')).toBe(12.5)
  })

  it('treats an empty field as zero', () => {
    expect(parseMoney('')).toBe(0)
    expect(parseMoney('  ')).toBe(0)
    expect(parseMoney(undefined)).toBe(0)
  })

  it('keeps two decimals', () => {
    expect(parseMoney('10,999')).toBe(11)
    expect(parseMoney('0,015')).toBe(0.02)
  })

  it('refuses what is not an amount', () => {
    for (const text of ['abc', '12a', '-5', '1,2,3', '1.2.3', '1.23.456', ',', '.', '12 reais']) {
      expect(parseMoney(text), text).toBeNull()
    }
  })
})

describe('formatWhen', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  const ago = (ms) => new Date(now - ms).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('says it the way a person would', () => {
    expect(formatWhen(ago(20_000), now)).toBe('agora')
    expect(formatWhen(ago(5 * MIN), now)).toBe('há 5 min')
    expect(formatWhen(ago(3 * HOUR), now)).toBe('há 3 h')
    expect(formatWhen(ago(30 * HOUR), now)).toBe('ontem')
    expect(formatWhen(ago(4 * DAY), now)).toBe('há 4 dias')
  })

  it('gives the date after a week', () => {
    expect(formatWhen('2026-10-01T15:00:00Z', now)).toMatch(/^\d{2}\/\d{2}\/2026$/)
  })

  it('treats a clock that is slightly ahead as now, and garbage as nothing', () => {
    expect(formatWhen(ago(-30_000), now)).toBe('agora')
    expect(formatWhen('not a date', now)).toBe('')
    expect(formatWhen(undefined, now)).toBe('')
  })
})

describe('addTagName', () => {
  it('adds a trimmed name', () => {
    expect(addTagName(['VIP'], '  Indicação  ')).toEqual(['VIP', 'Indicação'])
    expect(addTagName([], 'cliente   antigo')).toEqual(['cliente antigo'])
  })

  it('does not add the same tag twice, whatever the capitalisation', () => {
    const names = ['VIP']
    expect(addTagName(names, 'vip')).toBe(names)
    expect(addTagName(names, ' Vip ')).toBe(names)
  })

  it('does not add nothing, or something too long to be a tag', () => {
    const names = ['VIP']
    expect(addTagName(names, '')).toBe(names)
    expect(addTagName(names, '   ')).toBe(names)
    expect(addTagName(names, 'x'.repeat(41))).toBe(names)
    expect(addTagName(names, undefined)).toBe(names)
  })
})
