import { describe, expect, it } from 'vitest'

import { normalizeLead } from '@/lib/leads/parse'
import { evaluate } from './engine'
import { buildLeadPayload, splitCity } from './lead'
import { findQuizModel } from './templates'

const quiz = findQuizModel('moveis-planejados')!.definition

const answers = {
  primeiro_nome: 'Ana',
  tipo: 'loja',
  cargo: 'gerente',
  decisao: 'so_dono',
  faturamento: '75a150',
  ticket: '15a40',
  origem: 'indicacao',
  desafio: 'preco',
  investimento: 'ate2500',
  prazo: 'ja',
  whatsapp: '+5563912345678',
  empresa: 'Planejados Silva',
  cidade: 'Palmas / TO',
  instagram: '@planejadossilva',
}

const source = {
  quizName: 'Quiz Móveis Planejados',
  sid: 'sid-12345678',
  answers,
  utms: { utm_campaign: 'nov', utm_content: 'video-1', fbclid: 'abc' },
}

describe('buildLeadPayload', () => {
  const payload = buildLeadPayload(quiz, source, evaluate(quiz, answers))
  const lead = normalizeLead(payload)

  it('is a Harpium Lead v1 the CRM reads without loss', () => {
    expect(lead.format).toBe('harpium-v1')
    expect(lead.origin).toBe('Quiz Móveis Planejados')
    expect(lead.source).toBe('quiz-moveis-planejados')
    expect(lead.externalId).toBe('sid-12345678')
    expect(lead.fullName).toBe('Ana')
    expect(lead.phone?.replace(/\D/g, '')).toBe('5563912345678')
    expect(lead.company).toBe('Planejados Silva')
    expect(lead.city).toBe('Palmas')
    expect(lead.fields.uf).toBe('TO')
    expect(lead.instagram?.replace('@', '')).toBe('planejadossilva')
  })

  it('carries the route and the tags the answers earned', () => {
    expect(lead.route).toBe('A')
    expect(lead.qualified).toBe(true)
    expect([...lead.tags].sort()).toEqual(
      ['decisor:nao', 'prioridade-baixa', 'quiz-planejados', 'verba-baixa'].sort(),
    )
  })

  it('sends each question with the words of its answer', () => {
    expect(lead.answers).toContainEqual({ pergunta: 'Faturamento mensal', resposta: 'De R$ 75 mil a R$ 150 mil' })
    expect(lead.answers).toContainEqual({ pergunta: 'Quem decide o investimento', resposta: 'Só o dono decide' })
    expect(lead.answers).toHaveLength(9)
    // Contact details are the contact, not answers.
    expect(lead.answers.some((a) => a.resposta.includes('Planejados Silva'))).toBe(false)
  })

  it('carries the campaign', () => {
    expect(lead.campaign).toBe('nov')
    expect(lead.campaignDetails).toMatchObject({ anuncio: 'video-1', utm_content: 'video-1', fbclid: 'abc' })
  })

  it('records the consent when the quiz shows a consent line', () => {
    const withConsent = { ...quiz, settings: { ...quiz.settings, consentText: 'Aceito receber contato.' } }
    const at = '2026-11-12T12:00:00.000Z'
    const accepted = normalizeLead(
      buildLeadPayload(withConsent, { ...source, consentAt: at }, evaluate(withConsent, answers)),
    )
    expect(accepted.consent).toEqual({ accepted: true, text: 'Aceito receber contato.', at })
    expect(lead.consent).toBeNull()
  })
})

describe('a partial lead', () => {
  it('has the answers so far, the "quiz-incompleto" tag and no route', () => {
    const payload = buildLeadPayload(quiz, source, null, 'Contato')
    const lead = normalizeLead(payload)
    expect(lead.externalId).toBe('sid-12345678:parcial')
    expect(lead.route).toBeNull()
    expect(lead.tags).toEqual(['quiz-planejados', 'quiz-incompleto'])
    expect(lead.note).toContain('Não concluiu (parou em "Contato")')
    expect(lead.answers.length).toBeGreaterThan(0)
  })
})

describe('splitCity', () => {
  it('separates the state when it is there', () => {
    expect(splitCity('Palmas / TO')).toEqual({ city: 'Palmas', uf: 'TO' })
    expect(splitCity('Palmas-to')).toEqual({ city: 'Palmas', uf: 'TO' })
    expect(splitCity('São Paulo, SP')).toEqual({ city: 'São Paulo', uf: 'SP' })
    expect(splitCity('Palmas')).toEqual({ city: 'Palmas', uf: '' })
  })
})
