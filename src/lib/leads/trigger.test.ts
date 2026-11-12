import { describe, expect, it } from 'vitest'

import { normalizeLead } from './parse'
import { buildLeadEventContext, handoffInput, leadMatchesTrigger, leadVars } from './trigger'

const quiz = normalizeLead({
  versao: '1',
  origem: 'quiz-planejados',
  contato: { nome: 'Ana Paula', telefone: '63999990000', empresa: 'Planejados Silva' },
  qualificacao: { rota: 'a' },
  etiquetas: ['Verba-Baixa', 'decisor:nao'],
  respostas: [{ pergunta: 'Investimento mensal', resposta: 'Menos de R$ 2.500' }],
  consentimento: { aceito: false },
})
const ctx = buildLeadEventContext(quiz, 'lead-9')

describe('buildLeadEventContext', () => {
  it('carries origin, route, tags (with the route tag) and consent', () => {
    expect(ctx).toMatchObject({
      lead_id: 'lead-9',
      source: 'quiz-planejados',
      rota: 'A',
      etiquetas: ['Verba-Baixa', 'decisor:nao', 'rota-a'],
      nome: 'Ana Paula',
      consentimento: false,
    })
  })
})

describe('leadMatchesTrigger', () => {
  it('an empty config matches every lead', () => {
    expect(leadMatchesTrigger({}, ctx)).toBe(true)
    expect(leadMatchesTrigger(null, ctx)).toBe(true)
  })

  it('needs a lead', () => {
    expect(leadMatchesTrigger({}, undefined)).toBe(false)
  })

  it('compares origins as slugs and tags without case', () => {
    expect(leadMatchesTrigger({ origens: ['Quiz Planejados', 'google'] }, ctx)).toBe(true)
    expect(leadMatchesTrigger({ origens: ['google'] }, ctx)).toBe(false)
    expect(leadMatchesTrigger({ etiquetas: ['verba-baixa', 'ROTA-A'] }, ctx)).toBe(true)
    expect(leadMatchesTrigger({ etiquetas: ['verba-baixa', 'outra'] }, ctx)).toBe(false)
  })

  it('filters by route', () => {
    expect(leadMatchesTrigger({ rota: 'a' }, ctx)).toBe(true)
    expect(leadMatchesTrigger({ rota: 'C' }, ctx)).toBe(false)
    expect(leadMatchesTrigger({ rota: '' }, ctx)).toBe(true)
  })
})

describe('leadVars and handoffInput', () => {
  it('exposes message variables', () => {
    expect(leadVars(ctx)).toMatchObject({
      nome: 'Ana Paula',
      primeiro_nome: 'Ana',
      empresa: 'Planejados Silva',
      origem: 'quiz-planejados',
      rota: 'A',
    })
  })

  it('briefs the agent with the answers and the instruction', () => {
    const input = handoffInput(ctx, '  Peça para incluir o dono  ')
    expect(input.respostas_do_lead).toBe('Investimento mensal: Menos de R$ 2.500')
    expect(input.instrucao).toBe('Peça para incluir o dono')
    expect(input.motivo).toContain('quiz-planejados')
    expect(handoffInput(undefined, '')).toEqual({})
  })
})
