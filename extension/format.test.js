import { describe, expect, it } from 'vitest'

import { fillQuickReply } from '../src/lib/quick-replies/variables'
import { countDueNow as serverCountDueNow, describeDue as serverDescribeDue } from '../src/lib/tasks/due'
import {
  addTagName,
  boardColumns,
  chatPhone,
  countDueNow,
  describeDue,
  fillTemplate,
  filterDeals,
  filterReplies,
  cleanSignatureName,
  signText,
  formatWhen,
  localInputToIso,
  parseMoney,
} from './format.js'

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

  it('finds a reply with a file by the file name', () => {
    const withFile = [
      ...replies,
      { id: '4', title: 'Material', text: '', media: { kind: 'document', filename: 'Catálogo 2026.pdf' } },
    ]
    expect(filterReplies(withFile, 'catalogo').map((r) => r.id)).toEqual(['4'])
  })

  it('copes with nothing', () => {
    expect(filterReplies(undefined, 'x')).toEqual([])
    expect(filterReplies([{ id: '9' }], 'x')).toEqual([])
  })
})


describe('boardColumns', () => {
  const stages = [
    { id: 's1', name: 'Novo' },
    { id: 's2', name: 'Proposta' },
    { id: 's3', name: 'Negociação' },
  ]
  const deal = (id, stage, value, currency = 'BRL') => ({ id, value, currency, stage: { id: stage } })

  it('makes one column per stage, in board order, with its deals', () => {
    const columns = boardColumns(stages, [deal('a', 's2', 100), deal('b', 's1', 50), deal('c', 's2', 25.5)])
    expect(columns.map((c) => [c.stage.name, c.deals.map((d) => d.id)])).toEqual([
      ['Novo', ['b']],
      ['Proposta', ['a', 'c']],
      ['Negociação', []],
    ])
    expect(columns[1].total).toEqual({ currency: 'BRL', value: 125.5 })
  })

  it('has no total for a column that mixes currencies', () => {
    const [column] = boardColumns([stages[0]], [deal('a', 's1', 100), deal('b', 's1', 50, 'USD')])
    expect(column.total).toBeNull()
  })

  it('totals an empty column as nothing', () => {
    expect(boardColumns([stages[0]], [])[0].total).toBeNull()
  })

  it('keeps a deal whose stage is gone, in a last column', () => {
    const columns = boardColumns(stages, [deal('a', 'deleted', 10), { id: 'b', value: 5 }])
    expect(columns).toHaveLength(4)
    expect(columns[3].stage).toEqual({ id: null, name: 'Sem etapa' })
    expect(columns[3].deals.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('reads a value that arrives as text, and ignores one that is not a number', () => {
    const [column] = boardColumns([stages[0]], [deal('a', 's1', '10.5'), deal('b', 's1', 'x')])
    expect(column.total.value).toBe(10.5)
  })

  it('copes with nothing', () => {
    expect(boardColumns(undefined, undefined)).toEqual([])
  })
})

describe('filterDeals', () => {
  const deals = [
    { id: '1', title: 'Plano anual', contact: { name: 'Maria Souza', phone: '+5531999998888' } },
    { id: '2', title: 'Consultoria', contact: { name: 'João Pedro', phone: '+5511987654321' } },
    { id: '3', title: 'Sem contato', contact: null },
  ]
  const ids = (query) => filterDeals(deals, query).map((d) => d.id)

  it('looks in the title, the contact name and the phone', () => {
    expect(ids('')).toEqual(['1', '2', '3'])
    expect(ids('anual')).toEqual(['1'])
    expect(ids('joao')).toEqual(['2'])
    expect(ids('98765')).toEqual(['2'])
    expect(ids('plano maria')).toEqual(['1'])
    expect(ids('plano joao')).toEqual([])
    expect(ids('contato')).toEqual(['3'])
  })
})

describe('chatPhone', () => {
  it('gives the digits of a full number', () => {
    expect(chatPhone('+55 (31) 99999-8888')).toBe('5531999998888')
    expect(chatPhone('5511987654321')).toBe('5511987654321')
  })

  it('refuses what is not a full number', () => {
    for (const phone of ['', null, undefined, '99999-8888', '123', '1'.repeat(16), 'abc']) {
      expect(chatPhone(phone), String(phone)).toBeNull()
    }
  })
})

describe('describeDue and countDueNow', () => {
  // The CRM shows the same tasks with describeDue from
  // src/lib/tasks/due.ts. The two must say the same thing.
  const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
  const now = at(2026, 11, 10, 12, 0)
  const DATES = [
    at(2026, 11, 10, 14, 0),
    at(2026, 11, 10, 9, 0),
    at(2026, 11, 11, 9, 5),
    at(2026, 11, 9, 16, 30),
    at(2026, 11, 3, 8, 0),
    at(2026, 11, 20, 16, 30),
    at(2027, 1, 5, 10, 0),
    at(2025, 12, 31, 23, 59),
  ].map((d) => d.toISOString())

  it('matches the CRM rule exactly', () => {
    for (const due of [...DATES, null, undefined, '', 'não é data']) {
      expect(describeDue(due, now), String(due)).toEqual(serverDescribeDue(due, now))
    }
    const tasks = DATES.map((due_at, i) => ({ due_at, done_at: i % 3 === 0 ? DATES[0] : null }))
    expect(countDueNow(tasks, now)).toBe(serverCountDueNow(tasks, now))
  })

  it('says it the way a person would', () => {
    expect(describeDue(DATES[0], now)).toEqual({ label: 'hoje às 14:00', tone: 'today' })
    expect(describeDue(DATES[3], now)).toEqual({ label: 'atrasada · ontem às 16:30', tone: 'overdue' })
    expect(countDueNow([{ due_at: DATES[0] }, { due_at: DATES[2] }, { due_at: null }], now)).toBe(1)
    expect(countDueNow(undefined, now)).toBe(0)
  })
})

describe('localInputToIso', () => {
  it('reads a datetime-local value as the person’s own time', () => {
    expect(localInputToIso('2026-11-12T14:00')).toBe(new Date(2026, 10, 12, 14, 0).toISOString())
  })

  it('gives null for an empty or unreadable field', () => {
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('   ')).toBeNull()
    expect(localInputToIso(undefined)).toBeNull()
    expect(localInputToIso('amanhã')).toBeNull()
  })
})

describe('signText', () => {
  it('puts the name in bold on top', () => {
    expect(signText('Olá, tudo bem?', 'Ana Lima')).toBe('*Ana Lima:*\nOlá, tudo bem?')
  })

  it('leaves the text alone without a name, or without text', () => {
    expect(signText('Olá', '')).toBe('Olá')
    expect(signText('Olá', '   ')).toBe('Olá')
    expect(signText('', 'Ana')).toBe('')
    expect(signText('  ', 'Ana')).toBe('  ')
  })
})

describe('cleanSignatureName', () => {
  it('keeps one plain line', () => {
    expect(cleanSignatureName('  Ana \n Lima ')).toBe('Ana Lima')
    // Marks that would close the bold early.
    expect(cleanSignatureName('*Ana* _Lima_')).toBe('Ana Lima')
  })

  it('cuts long names', () => {
    expect(cleanSignatureName('a'.repeat(60))).toHaveLength(40)
  })

  it('is empty for nothing', () => {
    expect(cleanSignatureName(null)).toBe('')
    expect(cleanSignatureName('**')).toBe('')
  })
})
