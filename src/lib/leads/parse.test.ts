import { describe, it, expect } from 'vitest'
import {
  foldKey,
  isHarpiumV1,
  leadTags,
  normalizeLead,
  normalizeLeadPhone,
  slugify,
} from './parse'

describe('normalizeLead — Google Lead Form', () => {
  it('maps user_column_data columns', () => {
    const r = normalizeLead({
      lead_id: 'g-123',
      form_id: 'form-9',
      campaign_id: 'camp-1',
      google_key: 'secret',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Ana Souza' },
        { column_id: 'EMAIL', string_value: 'ana@ex.com' },
        { column_id: 'PHONE_NUMBER', string_value: '+5511999998888' },
        { column_id: 'COMPANY_NAME', string_value: 'Acme' },
      ],
    })
    expect(r).toMatchObject({
      source: 'google',
      format: 'google',
      fullName: 'Ana Souza',
      email: 'ana@ex.com',
      phone: '+5511999998888',
      company: 'Acme',
      campaign: 'camp-1',
      formName: 'form-9',
      externalId: 'g-123',
      answers: [],
    })
  })

  it('joins first + last name when FULL_NAME is absent', () => {
    const r = normalizeLead({
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'Ana' },
        { column_id: 'LAST_NAME', string_value: 'Souza' },
      ],
    })
    expect(r.source).toBe('google')
    expect(r.fullName).toBe('Ana Souza')
  })

  it('turns extra columns into answers instead of dropping them', () => {
    const r = normalizeLead({
      gcl_id: 'gcl-1',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Ana' },
        { column_id: 'CITY', string_value: 'Palmas' },
        { column_id: 'JOB_TITLE', string_value: 'Dona' },
        {
          column_id: 'what_is_your_budget?',
          column_name: 'Qual o seu orçamento?',
          string_value: 'R$ 5 mil',
        },
      ],
    })
    expect(r.city).toBe('Palmas')
    expect(r.answers).toEqual([
      { pergunta: 'Job title', resposta: 'Dona' },
      { pergunta: 'Qual o seu orçamento?', resposta: 'R$ 5 mil' },
    ])
    expect(r.campaignDetails.gclid).toBe('gcl-1')
  })
})

describe('normalizeLead — Meta Lead Ads', () => {
  it('maps field_data with values arrays', () => {
    const r = normalizeLead({
      id: 'm-777',
      form_id: 'f-1',
      campaign_name: 'Promo Julho',
      field_data: [
        { name: 'full_name', values: ['João Lima'] },
        { name: 'email', values: ['joao@ex.com'] },
        { name: 'phone_number', values: ['+5521988887777'] },
      ],
    })
    expect(r).toMatchObject({
      source: 'meta',
      fullName: 'João Lima',
      email: 'joao@ex.com',
      phone: '+5521988887777',
      campaign: 'Promo Julho',
      formName: 'f-1',
      externalId: 'm-777',
    })
  })

  it('keeps custom questions as answers', () => {
    const r = normalizeLead({
      adset_name: 'Conjunto 1',
      field_data: [
        { name: 'full_name', values: ['João'] },
        { name: 'qual_o_seu_faturamento?', values: ['R$ 100 mil'] },
        { name: 'servicos', values: ['Site', 'Tráfego'] },
      ],
    })
    expect(r.answers).toEqual([
      { pergunta: 'Qual o seu faturamento?', resposta: 'R$ 100 mil' },
      { pergunta: 'Servicos', resposta: 'Site, Tráfego' },
    ])
    expect(r.campaignDetails.conjunto).toBe('Conjunto 1')
  })
})

describe('normalizeLead — Harpium Lead v1', () => {
  const quiz = {
    versao: '1',
    origem: 'quiz-planejados',
    id_externo: 'sessao-7f3c',
    contato: {
      nome: 'Ana',
      telefone: '+5563999990000',
      empresa: 'Planejados Silva',
      cidade: 'Palmas',
      uf: 'TO',
      instagram: '@planejadossilva',
    },
    campanha: {
      utm_source: 'meta',
      utm_campaign: 'planejados-nov',
      utm_content: 'video-1milhao',
      fbclid: 'abc123',
    },
    qualificacao: { rota: 'A', qualificado: true, motivos: ['perfil completo'] },
    etiquetas: ['quiz-planejados', 'rota-a', 'verba-baixa'],
    respostas: [
      { pergunta: 'Faturamento mensal', resposta: 'De R$ 75 mil a R$ 150 mil' },
      { pergunta: 'Investimento mensal', resposta: 'Menos de R$ 2.500' },
      { pergunta: 'Maior desafio', resposta: 'Atraio muita gente procurando só preço' },
    ],
    campos: { faturamento: '75a150', ticket_medio: '40a80' },
  }

  it('reads the quiz example from the spec', () => {
    const r = normalizeLead(quiz)
    expect(isHarpiumV1(quiz)).toBe(true)
    expect(r).toMatchObject({
      format: 'harpium-v1',
      source: 'quiz-planejados',
      origin: 'quiz-planejados',
      externalId: 'sessao-7f3c',
      fullName: 'Ana',
      phone: '+5563999990000',
      company: 'Planejados Silva',
      city: 'Palmas',
      instagram: '@planejadossilva',
      campaign: 'planejados-nov',
      route: 'A',
      qualified: true,
      reasons: ['perfil completo'],
      tags: ['quiz-planejados', 'rota-a', 'verba-baixa'],
    })
    expect(r.answers).toHaveLength(3)
    expect(r.fields).toEqual({ uf: 'TO', faturamento: '75a150', ticket_medio: '40a80' })
    expect(r.campaignDetails).toMatchObject({ utm_source: 'meta', fbclid: 'abc123' })
  })

  it('adds the route tag once', () => {
    expect(leadTags(normalizeLead(quiz))).toEqual(['quiz-planejados', 'rota-a', 'verba-baixa'])
    const noRouteTag = { ...quiz, etiquetas: ['x'] }
    expect(leadTags(normalizeLead(noRouteTag))).toEqual(['x', 'rota-a'])
  })

  it('accepts versao as a number and lenient shapes', () => {
    const r = normalizeLead({
      versao: 1,
      origem: 'Site Principal',
      nome: 'Bia',
      telefone: '(11) 98888-7777',
      etiquetas: 'a, b ,a',
      respostas: { 'Qual serviço?': ['Site', 'SEO'] },
      consentimento: { aceito: 'sim', texto: 'Aceito receber contato', em: '2026-11-11' },
    })
    expect(r.format).toBe('harpium-v1')
    expect(r.source).toBe('site-principal')
    expect(r.fullName).toBe('Bia')
    expect(r.phone).toBe('+5511988887777')
    expect(r.tags).toEqual(['a', 'b'])
    expect(r.answers).toEqual([{ pergunta: 'Qual serviço?', resposta: 'Site, SEO' }])
    expect(r.consent).toEqual({ accepted: true, text: 'Aceito receber contato', at: '2026-11-11' })
  })

  it('reads the route in any spelling', () => {
    for (const rota of ['b', 'B', 'rota-b', 'Rota B']) {
      expect(normalizeLead({ versao: '1', qualificacao: { rota } }).route).toBe('B')
    }
    expect(normalizeLead({ versao: '1', qualificacao: { rota: 'Z' } }).route).toBeNull()
  })
})

describe('normalizeLead — generic JSON', () => {
  it('reads flat English keys and declared source', () => {
    const r = normalizeLead({
      source: 'meta',
      name: 'Carla',
      email: 'carla@ex.com',
      phone: '+5511911112222',
      campaign: 'Black Friday',
    })
    expect(r.source).toBe('meta')
    expect(r.fullName).toBe('Carla')
    expect(r.phone).toBe('+5511911112222')
    expect(r.campaign).toBe('Black Friday')
    expect(r.fields).toEqual({})
  })

  it('reads pt-BR aliases', () => {
    const r = normalizeLead({
      nome: 'Pedro',
      telefone: '+5511900000000',
      empresa: 'Loja X',
      campanha: 'Verão',
    })
    expect(r).toMatchObject({
      source: 'other',
      fullName: 'Pedro',
      phone: '+5511900000000',
      company: 'Loja X',
      campaign: 'Verão',
    })
  })

  it('keeps every unknown key as a field, UTMs as campaign details', () => {
    const r = normalizeLead({
      nome: 'Pedro',
      whatsapp: '11 98888-7777',
      origem: 'Landing Black',
      utm_source: 'google',
      faturamento: '50 mil',
      'Qual seu maior desafio?': 'Preço',
      endereco: { rua: 'A', numero: 10 },
      etiquetas: ['lp', 'black'],
      google_key: 'nunca-na-nota',
    })
    expect(r.source).toBe('landing-black')
    expect(r.origin).toBe('Landing Black')
    expect(r.phone).toBe('+5511988887777')
    expect(r.campaignDetails).toEqual({ utm_source: 'google' })
    expect(r.tags).toEqual(['lp', 'black'])
    expect(r.fields).toEqual({
      faturamento: '50 mil',
      'Qual seu maior desafio?': 'Preço',
      'endereco.rua': 'A',
      'endereco.numero': '10',
    })
  })

  it('does not crash on empty / non-object payloads', () => {
    expect(normalizeLead(null).source).toBe('other')
    expect(normalizeLead('nope').fullName).toBeNull()
    expect(normalizeLead({}).phone).toBeNull()
  })
})

describe('normalizeLeadPhone', () => {
  it('fills in the country code and the ninth digit', () => {
    expect(normalizeLeadPhone('(63) 99999-0000')).toBe('+5563999990000')
    expect(normalizeLeadPhone('63 9999-0000')).toBe('+5563999990000')
    expect(normalizeLeadPhone('+55 63 9999-0000')).toBe('+5563999990000')
    expect(normalizeLeadPhone('5563999990000')).toBe('+5563999990000')
    expect(normalizeLeadPhone('063 99999-0000')).toBe('+5563999990000')
  })

  it('leaves landlines and other countries alone', () => {
    expect(normalizeLeadPhone('(11) 3333-4444')).toBe('+551133334444')
    expect(normalizeLeadPhone('+1 415 555 0100')).toBe('+14155550100')
  })

  it('rejects what cannot be a phone', () => {
    expect(normalizeLeadPhone('123')).toBeNull()
    expect(normalizeLeadPhone('')).toBeNull()
    expect(normalizeLeadPhone(null)).toBeNull()
  })
})

describe('key helpers', () => {
  it('fold keys and slugs the same way across spellings', () => {
    expect(foldKey('Ticket médio')).toBe('ticket_medio')
    expect(foldKey('ticket-medio')).toBe('ticket_medio')
    expect(slugify('Quiz Planejados!')).toBe('quiz-planejados')
  })
})
