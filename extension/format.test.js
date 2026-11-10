import { describe, expect, it } from 'vitest'

import { fillQuickReply } from '../src/lib/quick-replies/variables'
import { addTagName, fillTemplate, filterReplies, formatWhen, parseMoney } from './format.js'

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


describe('fillTemplate', () => {
  // The CRM's inbox fills the same variables with fillQuickReply. A
  // reply written once must read the same in both places.
  const TEXTS = [
    'Olá {{primeiro_nome}}! Falo com {{nome}}, da {{empresa}}?',
    'Oi {{ Nome }} / {{PRIMEIRO_NOME}}',
    'Nosso horário é das 8h às 18h :)\n\nQualquer coisa , chame.',
    'Olá {{primeiro_nome}}, tudo bem?',
    'Olá {{nome}} tudo bem?',
    'Obrigado, {{nome}}',
    'Obrigado {{nome}}!',
    '{{nome}}, bom dia!\n{{empresa}} confirmou?',
    '{{empresa}} {{nome}} {{empresa}} {{primeiro_nome}}',
    'Oi {{vars.name}} e {{sobrenome}} e {nome}',
    '',
  ]
  const CONTACTS = [
    { name: 'Maria Souza Lima', company: 'Clínica Sol' },
    { name: 'Ana' },
    { name: '5531999998888', company: '  ' },
    { name: '+55 (31) 99999-8888' },
    { name: 'Loja 24h', company: 'Loja 24h Ltda' },
    { name: null, company: null },
    {},
  ]

  it('matches the CRM rule exactly', () => {
    for (const text of TEXTS) {
      for (const contact of CONTACTS) {
        expect(fillTemplate(text, contact), `${text} | ${JSON.stringify(contact)}`).toEqual(
          fillQuickReply(text, contact),
        )
      }
    }
  })

  it('fills a name and closes the gap of a missing one', () => {
    expect(fillTemplate('Olá {{primeiro_nome}}, tudo bem?', { name: 'Maria Souza' })).toEqual({
      text: 'Olá Maria, tudo bem?',
      missing: [],
    })
    expect(fillTemplate('Olá {{primeiro_nome}}, tudo bem?', undefined)).toEqual({
      text: 'Olá, tudo bem?',
      missing: ['primeiro_nome'],
    })
  })
})

describe('filterReplies', () => {
  const replies = [
    { id: '1', title: 'Saudação', text: 'Olá {{primeiro_nome}}, tudo bem?' },
    { id: '2', title: 'Horário', text: 'Atendemos das 8h às 18h.' },
    { id: '3', title: 'Pix', text: 'Nossa chave é o CNPJ.' },
  ]
  const ids = (query) => filterReplies(replies, query).map((r) => r.id)

  it('returns everything for an empty search', () => {
    expect(ids('')).toEqual(['1', '2', '3'])
    expect(ids('   ')).toEqual(['1', '2', '3'])
  })

  it('looks in the title and in the text, ignoring accents and case', () => {
    expect(ids('saudacao')).toEqual(['1'])
    expect(ids('OLA')).toEqual(['1'])
    expect(ids('cnpj')).toEqual(['3'])
    expect(ids('horario')).toEqual(['2'])
  })

  it('needs every word, in any order', () => {
    expect(ids('18h atendemos')).toEqual(['2'])
    expect(ids('atendemos pix')).toEqual([])
  })

  it('copes with nothing', () => {
    expect(filterReplies(undefined, 'x')).toEqual([])
    expect(filterReplies([{ id: '9' }], 'x')).toEqual([])
  })
})
