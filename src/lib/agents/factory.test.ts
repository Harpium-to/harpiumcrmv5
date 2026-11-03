import { describe, it, expect } from 'vitest'
import { parseDraft } from './factory'

const VALID = {
  name: 'Prospector Palmas',
  role: 'prospector',
  department: 'Prospecção',
  objective: 'Encontrar empresas de móveis planejados em Palmas.',
  system_prompt:
    'Você é o agente prospector. Encontra empresas e cadastra como lead. Nunca invente preço, prazo ou condição.',
  keywords: ['moveis', 'planejados'],
  tools: ['research', 'crm'],
  channels: ['whatsapp'],
  goals: { leads_per_day: 20 },
  priority: 30,
}

describe('parseDraft', () => {
  it('parses a clean JSON object', () => {
    const draft = parseDraft(JSON.stringify(VALID))
    expect(draft?.name).toBe('Prospector Palmas')
    expect(draft?.role).toBe('prospector')
    expect(draft?.goals).toEqual({ leads_per_day: 20 })
  })

  it('survives a markdown code fence', () => {
    const draft = parseDraft('```json\n' + JSON.stringify(VALID) + '\n```')
    expect(draft?.name).toBe('Prospector Palmas')
  })

  it('survives chatty text around the object', () => {
    const draft = parseDraft(
      `Claro! Aqui está a configuração:\n${JSON.stringify(VALID)}\nEspero ter ajudado.`,
    )
    expect(draft?.name).toBe('Prospector Palmas')
  })

  it('is not fooled by a brace inside a string value', () => {
    const tricky = { ...VALID, objective: 'Usa o formato {nome} no texto.' }
    const draft = parseDraft(JSON.stringify(tricky))
    expect(draft?.objective).toBe('Usa o formato {nome} no texto.')
  })

  it('always returns an inactive, lowest-autonomy draft', () => {
    // The model asking for full autonomy must not get it.
    const draft = parseDraft(JSON.stringify({ ...VALID, autonomy: 4 }))
    expect(draft?.autonomy).toBe(1)
  })

  it('drops tools and channels outside the vocabulary', () => {
    const draft = parseDraft(
      JSON.stringify({
        ...VALID,
        tools: ['crm', 'send_invoice', 'wire_transfer'],
        channels: ['whatsapp', 'telegram'],
      }),
    )
    expect(draft?.tools).toEqual(['crm'])
    expect(draft?.channels).toEqual(['whatsapp'])
  })

  it('falls back to custom for an unknown role', () => {
    const draft = parseDraft(JSON.stringify({ ...VALID, role: 'ninja' }))
    expect(draft?.role).toBe('custom')
  })

  it('slugifies the department', () => {
    expect(parseDraft(JSON.stringify(VALID))?.department).toBe('prospeccao')
    expect(
      parseDraft(JSON.stringify({ ...VALID, department: '  ' }))?.department,
    ).toBe('geral')
  })

  it('rejects a draft with no name or a stub prompt', () => {
    expect(parseDraft(JSON.stringify({ ...VALID, name: '' }))).toBeNull()
    expect(parseDraft(JSON.stringify({ ...VALID, system_prompt: 'oi' }))).toBeNull()
  })

  it('rejects anything that is not a JSON object', () => {
    expect(parseDraft('desculpe, não consegui')).toBeNull()
    expect(parseDraft('[1,2,3]')).toBeNull()
    expect(parseDraft('{ "name": }')).toBeNull()
    expect(parseDraft('')).toBeNull()
  })

  it('drops non-numeric goals rather than writing NaN', () => {
    const draft = parseDraft(
      JSON.stringify({ ...VALID, goals: { a: 'muitos', b: 5, c: -3 } }),
    )
    expect(draft?.goals).toEqual({ b: 5 })
  })
})
