import { describe, it, expect } from 'vitest'
import { normalizeGoals, normalizeKeywords, parseAgentPayload } from './payload'

describe('normalizeKeywords', () => {
  it('splits a comma-separated string and trims each entry', () => {
    expect(normalizeKeywords('preço, comprar ,  valor ')).toEqual([
      'preço',
      'comprar',
      'valor',
    ])
  })

  it('accepts an array unchanged', () => {
    expect(normalizeKeywords(['boleto', 'fatura'])).toEqual(['boleto', 'fatura'])
  })

  it('deduplicates on the folded form, keeping the first spelling', () => {
    expect(normalizeKeywords('Preço, preco, PREÇO')).toEqual(['Preço'])
  })

  it('drops empties and non-strings', () => {
    expect(normalizeKeywords([' ', 'ok', 42, null])).toEqual(['ok'])
    expect(normalizeKeywords('a,,,b')).toEqual(['a', 'b'])
  })

  it('returns an empty list for anything else', () => {
    expect(normalizeKeywords(undefined)).toEqual([])
    expect(normalizeKeywords({})).toEqual([])
  })
})

describe('parseAgentPayload', () => {
  it('requires a name and a prompt on create', () => {
    expect(parseAgentPayload({ system_prompt: 'x' }, { partial: false })).toHaveProperty(
      'error',
    )
    expect(parseAgentPayload({ name: 'Vendas' }, { partial: false })).toHaveProperty(
      'error',
    )
  })

  it('allows a single field on update', () => {
    const result = parseAgentPayload({ is_active: true }, { partial: true })
    expect(result).toEqual({ values: { is_active: true } })
  })

  it('stores an empty model as null so inheritance stays a null check', () => {
    const result = parseAgentPayload({ model: '   ' }, { partial: true })
    expect(result).toEqual({ values: { model: null } })
  })

  it('clamps priority and the reply cap into their column ranges', () => {
    expect(
      parseAgentPayload(
        { priority: 9999, max_replies_per_conversation: 0 },
        { partial: true },
      ),
    ).toEqual({ values: { priority: 100, max_replies_per_conversation: 1 } })
  })

  it('ignores absent fields rather than defaulting them', () => {
    // A PATCH that only toggles the switch must not silently reset
    // keywords or priority to their defaults.
    const result = parseAgentPayload({ is_active: false }, { partial: true })
    expect(result).toEqual({ values: { is_active: false } })
  })

  it('rejects a non-object body', () => {
    expect(parseAgentPayload(null, { partial: true })).toHaveProperty('error')
    expect(parseAgentPayload('nope', { partial: true })).toHaveProperty('error')
  })
})

describe('normalizeGoals', () => {
  it('keeps positive integer targets', () => {
    expect(normalizeGoals({ leads_per_day: 20, closes_per_month: 10 })).toEqual({
      leads_per_day: 20,
      closes_per_month: 10,
    })
  })

  it('drops a target of zero', () => {
    // Zero is the absence of a target, not a target of none — and
    // typing 0 in the form is how an operator clears one.
    expect(normalizeGoals({ leads_per_day: 0, closes_per_month: 3 })).toEqual({
      closes_per_month: 3,
    })
  })

  it('drops negative and unparseable values', () => {
    expect(normalizeGoals({ a: -5, b: 'muitos', c: null, d: 2 })).toEqual({ d: 2 })
  })

  it('rounds a fractional target', () => {
    expect(normalizeGoals({ leads_per_day: 7.6 })).toEqual({ leads_per_day: 8 })
  })

  it('ignores anything that is not an object of numbers', () => {
    expect(normalizeGoals(null)).toEqual({})
    expect(normalizeGoals([1, 2])).toEqual({})
    expect(normalizeGoals('leads')).toEqual({})
  })

  it('goes through parseAgentPayload on both create and patch', () => {
    expect(
      parseAgentPayload({ goals: { leads_per_day: 5, bogus: 0 } }, { partial: true }),
    ).toEqual({ values: { goals: { leads_per_day: 5 } } })
  })
})
