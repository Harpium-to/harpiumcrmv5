import { describe, expect, it } from 'vitest'

import {
  applyFilter,
  buildPeople,
  buildReport,
  NO_CAMPAIGN,
  parseSince,
  peopleTable,
  type ReportSession,
} from './report'
import { findQuizModel } from './templates'

const quiz = findQuizModel('moveis-planejados')!.definition

let n = 0
function visit(over: Partial<ReportSession> = {}): ReportSession {
  n += 1
  return {
    id: `s${n}`,
    steps: ['intro'],
    last_step: 'intro',
    answers: {},
    contact: {},
    result_id: null,
    route: null,
    utms: {},
    device: 'mobile',
    started_at: null,
    completed_at: null,
    cta_clicks: 0,
    lead_id: null,
    contact_id: null,
    lead_status: null,
    created_at: '2026-11-12T12:00:00.000Z',
    ...over,
  }
}

const ALL_STEPS = ['intro', 'nome', 'tipo', 'cargo', 'faturamento', 'ticket', 'origem', 'desafio', 'investimento', 'prazo', 'contato']

/** Finished, 90 seconds after opening. */
function finished(resultId: string, route: 'A' | 'B' | 'C', over: Partial<ReportSession> = {}) {
  return visit({
    steps: [...ALL_STEPS, 'result'],
    last_step: 'contato',
    started_at: '2026-11-12T12:00:05.000Z',
    completed_at: '2026-11-12T12:01:30.000Z',
    result_id: resultId,
    route,
    lead_id: `lead-${n}`,
    contact_id: `contact-${n}`,
    lead_status: 'ok',
    contact: { name: 'Ana', phone: '+5563912345678', company: 'Planejados Silva' },
    answers: { tipo: 'loja', cargo: 'dono', faturamento: '75a150', prazo: 'ja' },
    ...over,
  })
}

const sessions: ReportSession[] = [
  // Opened and left.
  visit({ utms: { utm_campaign: 'nov', utm_content: 'video-1' } }),
  // Started, stopped at the revenue question.
  visit({
    steps: ['intro', 'nome', 'tipo', 'cargo', 'faturamento'],
    last_step: 'faturamento',
    started_at: '2026-11-12T12:00:05.000Z',
    answers: { tipo: 'arquiteto', cargo: 'gerente' },
    contact: { name: 'Bia' },
    utms: { utm_campaign: 'nov', utm_content: 'video-2' },
    device: 'desktop',
  }),
  finished('a', 'A', { utms: { utm_campaign: 'nov', utm_content: 'video-1' }, cta_clicks: 0 }),
  finished('b', 'B', {
    utms: { utm_campaign: 'nov', utm_content: 'video-2' },
    cta_clicks: 2,
    answers: { tipo: 'loja', cargo: 'marketing', faturamento: '50a75' },
  }),
  // No campaign in the link.
  finished('c', 'C', { answers: { tipo: 'arquiteto', cargo: 'dono' }, lead_id: null, lead_status: 'sem_contato', contact: {} }),
]

describe('buildReport', () => {
  const report = buildReport(quiz, sessions)

  it('counts the period', () => {
    expect(report.totals).toMatchObject({
      visits: 5,
      started: 4,
      completed: 3,
      leads: 2,
      qualified: 1,
      ctaClicks: 2,
      ctaVisits: 1,
      medianSeconds: 90,
    })
  })

  it('says how many reached each screen and how many stopped on it', () => {
    const row = (id: string) => report.funnel.find((f) => f.id === id)!
    expect(report.funnel[0]).toMatchObject({ id: 'intro', label: 'Abriu a página', reached: 5, stopped: 1 })
    expect(row('faturamento')).toMatchObject({ label: 'Faturamento mensal', reached: 4, stopped: 1 })
    expect(row('contato')).toMatchObject({ reached: 3, stopped: 0 })
    expect(row('result')).toMatchObject({ label: 'Concluiu (viu o resultado)', reached: 3, stopped: 0 })
    // The question only managers see is flagged, so its smaller bar is not read as a leak.
    expect(row('decisao').conditional).toBe(true)
    expect(row('tipo').conditional).toBe(false)
  })

  it('counts the answers of each choice question', () => {
    const tipo = report.answers.find((a) => a.stepId === 'tipo')!
    expect(tipo.total).toBe(4)
    expect(Object.fromEntries(tipo.options.map((o) => [o.id, o.count]))).toMatchObject({
      loja: 2,
      arquiteto: 2,
      fabrica: 0,
    })
  })

  it('splits the results of who finished', () => {
    expect(report.results.map((r) => [r.id, r.count])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ])
  })

  it('groups by campaign and by creative, biggest first', () => {
    expect(report.campaigns).toEqual([
      { key: 'nov', visits: 4, completed: 2, leads: 2, qualified: 1 },
      { key: NO_CAMPAIGN, visits: 1, completed: 1, leads: 0, qualified: 0 },
    ])
    expect(report.creatives.find((c) => c.key === 'video-1')).toEqual({
      key: 'video-1',
      visits: 2,
      completed: 1,
      leads: 1,
      qualified: 1,
    })
  })

  it('splits by device', () => {
    expect(report.devices).toEqual([
      { key: 'mobile', visits: 4, completed: 3 },
      { key: 'desktop', visits: 1, completed: 0 },
    ])
  })

  it('narrows every number by a filter, but still offers every campaign', () => {
    const filtered = buildReport(quiz, sessions, { creative: 'video-2' })
    expect(filtered.totals).toMatchObject({ visits: 2, completed: 1, leads: 1, qualified: 0 })
    expect(filtered.choices.creatives).toEqual(['(sem criativo)', 'video-1', 'video-2'])
    expect(applyFilter(sessions, { campaign: NO_CAMPAIGN })).toHaveLength(1)
  })

  it('is all zeros for a quiz nobody opened', () => {
    const empty = buildReport(quiz, [])
    expect(empty.totals).toMatchObject({ visits: 0, completed: 0, medianSeconds: null })
    expect(empty.funnel.every((f) => f.reached === 0)).toBe(true)
    expect(empty.devices).toEqual([])
  })
})

describe('buildPeople', () => {
  const people = buildPeople(quiz, sessions)

  it('has one line per visit, with where it stopped or how it ended', () => {
    expect(people).toHaveLength(5)
    expect(people[0]).toMatchObject({ done: false, stoppedAt: 'Abriu a página', name: '' })
    expect(people[1]).toMatchObject({ done: false, stoppedAt: 'Faturamento mensal', name: 'Bia', device: 'Computador' })
    expect(people[2]).toMatchObject({
      done: true,
      resultName: 'A · Qualificado',
      route: 'A',
      phone: '(63) 91234-5678',
      campaign: 'nov',
      creative: 'video-1',
      stoppedAt: '',
    })
  })

  it('writes the answers in words', () => {
    expect(people[1].answers).toEqual([
      { question: 'Tipo de empresa', answer: 'Sou arquiteto(a) ou designer de interiores' },
      { question: 'Cargo', answer: 'Gerente da loja ou responsável comercial' },
    ])
  })

  it('becomes a table with a column per question', () => {
    const table = peopleTable(quiz, people)
    expect(table.headers.slice(0, 4)).toEqual(['Data', 'Nome', 'WhatsApp', 'E-mail'])
    expect(table.headers).toContain('Faturamento mensal')
    expect(table.rows).toHaveLength(5)
    for (const row of table.rows) expect(row).toHaveLength(table.headers.length)
    const b = table.rows[3]
    expect(b[table.headers.indexOf('Situação')]).toBe('Concluiu')
    expect(b[table.headers.indexOf('Resultado')]).toBe('B · Morno')
    expect(b[table.headers.indexOf('Faturamento mensal')]).toBe('De R$ 50 mil a R$ 75 mil')
    expect(b[table.headers.indexOf('Cliques no botão')]).toBe('2')
    expect(table.rows[4][table.headers.indexOf('Lead')]).toBe('Sem telefone nem e-mail')
  })
})

describe('parseSince', () => {
  it('reads a date and refuses anything else', () => {
    expect(parseSince('2026-11-12T03:00:00.000Z')).toBe('2026-11-12T03:00:00.000Z')
    expect(parseSince('not a date')).toBeNull()
    expect(parseSince(null)).toBeNull()
  })
})
