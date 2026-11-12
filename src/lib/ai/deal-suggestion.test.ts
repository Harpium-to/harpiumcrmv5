import { describe, expect, it } from 'vitest'
import {
  buildDealSuggestionPrompt,
  conversationTranscript,
  parseAmount,
  parseDealSuggestion,
  todayInBrazil,
} from './deal-suggestion'

const stages = [
  { id: 'st-new', name: 'Novo lead' },
  { id: 'st-qual', name: 'Qualificado' },
  { id: 'st-neg', name: 'Negociação' },
]
const ctx = { stages, today: '2026-11-09' }

describe('parseDealSuggestion', () => {
  it('reads a well-formed answer', () => {
    const text = JSON.stringify({
      title: 'Clareamento – Maria',
      value: 1200,
      expected_close_date: '2026-11-20',
      stage: 'Qualificado',
      notes: '- Quer clarear antes do casamento\n- Orçamento até R$ 1.200',
    })
    expect(parseDealSuggestion(text, ctx)).toEqual({
      title: 'Clareamento – Maria',
      value: 1200,
      expected_close_date: '2026-11-20',
      stage_id: 'st-qual',
      notes: '- Quer clarear antes do casamento\n- Orçamento até R$ 1.200',
    })
  })

  it('tolerates markdown fences and text around the JSON', () => {
    const text = 'Aqui está:\n```json\n{"title":"Plano anual – João","notes":"- Quer o plano anual"}\n```'
    expect(parseDealSuggestion(text, ctx)?.title).toBe('Plano anual – João')
  })

  it('drops values, dates and stages it cannot trust', () => {
    const text = JSON.stringify({
      title: 'Consulta',
      value: -50,
      expected_close_date: '2026-11-01', // already past
      stage: 'Etapa que não existe',
      notes: 'ok',
    })
    const s = parseDealSuggestion(text, ctx)!
    expect(s.value).toBeNull()
    expect(s.expected_close_date).toBeNull()
    expect(s.stage_id).toBeNull()
  })

  it('rejects impossible calendar dates', () => {
    const text = JSON.stringify({ title: 'X', expected_close_date: '2027-02-30', notes: '' })
    expect(parseDealSuggestion(text, ctx)?.expected_close_date).toBeNull()
  })

  it('matches the stage ignoring accents and case', () => {
    const text = JSON.stringify({ title: 'X', stage: 'negociacao', notes: '' })
    expect(parseDealSuggestion(text, ctx)?.stage_id).toBe('st-neg')
  })

  it('turns a list of notes into bullet lines', () => {
    const text = JSON.stringify({ title: 'X', notes: ['Quer orçamento', '- Prazo: dezembro'] })
    expect(parseDealSuggestion(text, ctx)?.notes).toBe('- Quer orçamento\n- Prazo: dezembro')
  })

  it('returns null when there is nothing usable', () => {
    expect(parseDealSuggestion('sem json aqui', ctx)).toBeNull()
    expect(parseDealSuggestion('{"title": "", "notes": ""}', ctx)).toBeNull()
    expect(parseDealSuggestion('[1,2]', ctx)).toBeNull()
    expect(parseDealSuggestion('{quebrado', ctx)).toBeNull()
  })

  it('caps the title length', () => {
    const text = JSON.stringify({ title: 'a'.repeat(500), notes: '' })
    expect(parseDealSuggestion(text, ctx)?.title).toHaveLength(120)
  })
})

describe('parseAmount', () => {
  it.each([
    [1500, 1500],
    ['1500', 1500],
    ['1.500', 1500],
    ['1.500,50', 1500.5],
    ['R$ 2.000,00', 2000],
    ['99.9', 99.9],
    [null, null],
    ['', null],
    ['abc', null],
    [-1, null],
  ])('%j → %j', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })
})

describe('prompt helpers', () => {
  it('labels who said what', () => {
    expect(
      conversationTranscript([
        { role: 'user', content: 'Oi, quanto custa?' },
        { role: 'assistant', content: 'R$ 300.' },
      ]),
    ).toBe('Cliente: Oi, quanto custa?\nEmpresa: R$ 300.')
  })

  it('lists the stages and today in the prompt', () => {
    const prompt = buildDealSuggestionPrompt({
      contactName: 'Maria',
      stages,
      currency: 'BRL',
      today: '2026-11-09',
    })
    expect(prompt).toContain('"Novo lead", "Qualificado", "Negociação"')
    expect(prompt).toContain('Hoje é 2026-11-09')
    expect(prompt).toContain('BRL')
    expect(prompt).toContain('Maria')
  })

  it('uses the Brazilian date late in the evening', () => {
    // 23:30 in São Paulo is already the next day in UTC.
    expect(todayInBrazil(new Date('2026-11-10T02:30:00Z'))).toBe('2026-11-09')
  })
})
