import { describe, it, expect } from 'vitest'
import { parseAnalysis } from './runner'

describe('parseAnalysis', () => {
  const valid = {
    briefing: 'Empresa de móveis planejados, 12 anos, site desatualizado.',
    temperature: 'warm',
    potential: 72,
    notes: ['Decisor é o sócio', 'Hipótese: não tem equipe de marketing'],
  }

  it('parses a clean object', () => {
    const result = parseAnalysis(JSON.stringify(valid))
    expect(result?.temperature).toBe('warm')
    expect(result?.potential).toBe(72)
    expect(result?.notes).toHaveLength(2)
  })

  it('survives prose around the object', () => {
    const result = parseAnalysis(`Aqui vai:\n${JSON.stringify(valid)}\nPronto.`)
    expect(result?.briefing).toBe(valid.briefing)
  })

  it('rejects a temperature outside the vocabulary', () => {
    // The column has a CHECK constraint; writing "morno" would make the
    // update fail at the database after the model call was already paid for.
    const result = parseAnalysis(
      JSON.stringify({ ...valid, temperature: 'morno' }),
    )
    expect(result?.temperature).toBeNull()
  })

  it('clamps potential into the column range', () => {
    expect(parseAnalysis(JSON.stringify({ ...valid, potential: 900 }))?.potential).toBe(100)
    expect(parseAnalysis(JSON.stringify({ ...valid, potential: -5 }))?.potential).toBe(0)
    expect(parseAnalysis(JSON.stringify({ ...valid, potential: 'alto' }))?.potential).toBeNull()
  })

  it('drops non-string notes', () => {
    const result = parseAnalysis(
      JSON.stringify({ ...valid, notes: ['ok', 42, null, '  '] }),
    )
    expect(result?.notes).toEqual(['ok'])
  })

  it('requires a briefing', () => {
    expect(parseAnalysis(JSON.stringify({ ...valid, briefing: '' }))).toBeNull()
    expect(parseAnalysis(JSON.stringify({ temperature: 'hot' }))).toBeNull()
  })

  it('rejects unparseable output', () => {
    expect(parseAnalysis('não consegui analisar')).toBeNull()
    expect(parseAnalysis('{ bad json ]')).toBeNull()
    expect(parseAnalysis('')).toBeNull()
  })
})
