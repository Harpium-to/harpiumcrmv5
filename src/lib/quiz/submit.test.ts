import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

const dispatched = vi.hoisted(() => ({ calls: [] as { leadId: string; contactId: string | null }[] }))
vi.mock('@/lib/leads/events', () => ({
  dispatchLeadReceived: async (_db: unknown, event: { leadId: string; contactId: string | null }) => {
    dispatched.calls.push(event)
  },
}))

const { parseSessionUpdate } = await import('./session')
const { recordVisit } = await import('./submit')
const { findQuizModel } = await import('./templates')

import type { PublishedQuiz } from './store'

const quiz: PublishedQuiz = {
  id: 'quiz-1',
  accountId: 'acc-1',
  name: 'Quiz Móveis Planejados',
  slug: 'planejados',
  definition: findQuizModel('moveis-planejados')!.definition,
}

const SID = 'b6f0c1de-0000-4000-8000-000000000001'
const context = { ip: '203.0.113.9', userAgent: 'UA', pageUrl: 'https://crm.test/q/planejados' }

/** A qualified owner (route A). */
const ANSWERS = {
  primeiro_nome: 'Ana',
  tipo: 'loja',
  cargo: 'dono',
  faturamento: '150a300',
  ticket: '40a80',
  origem: 'indicacao',
  desafio: 'poucos',
  investimento: '5000a10000',
  prazo: 'ja',
  whatsapp: '(63) 91234-5678',
  empresa: 'Planejados Silva',
  cidade: 'Palmas / TO',
}

let tables: Record<string, Row[]> = {}
let seq = 0

function send(body: Record<string, unknown>, sid = SID) {
  const update = parseSessionUpdate(quiz.definition, { sid, seq: ++seq, ...body })
  if (!update) throw new Error('the page would not send this')
  return recordVisit(fakeDb(tables), quiz, update, context)
}

const session = (sid = SID) => tables.quiz_sessions.find((r) => r.sid === sid) as Row

beforeEach(() => {
  seq = 0
  dispatched.calls = []
  tables = {
    accounts: [{ id: 'acc-1', owner_user_id: 'owner-1' }],
    quiz_sessions: [],
    contacts: [],
    leads: [],
    tags: [],
    contact_tags: [],
    custom_fields: [],
    contact_custom_values: [],
    contact_notes: [],
  }
})

describe('a visit in progress', () => {
  it('is one row, rewritten at every screen, that never loses a screen', async () => {
    await send({ steps: ['intro'], utms: { utm_campaign: 'nov', utm_content: 'video-1' } })
    expect(tables.quiz_sessions).toHaveLength(1)
    expect(session().started_at).toBeNull()

    await send({ steps: ['intro', 'nome'] })
    await send({ steps: ['intro', 'nome', 'tipo'], answers: { primeiro_nome: 'Ana' } })
    // The person went back: the browser's list is shorter now.
    await send({ steps: ['nome'], answers: { primeiro_nome: 'Ana Maria' } })

    expect(tables.quiz_sessions).toHaveLength(1)
    const row = session()
    expect(row.steps).toEqual(['intro', 'nome', 'tipo'])
    expect(row.last_step).toBe('tipo')
    expect(row.started_at).not.toBeNull()
    expect(row.contact).toEqual({ name: 'Ana Maria' })
    expect(row.completed_at ?? null).toBeNull()
    expect(tables.leads).toHaveLength(0)
  })

  it('keeps the campaign the visit arrived with', async () => {
    await send({ steps: ['intro'], utms: { utm_campaign: 'nov' } })
    await send({ steps: ['intro', 'nome'], utms: { utm_campaign: 'outra' } })
    expect(session().utms).toEqual({ utm_campaign: 'nov' })
  })

  it('ignores an older update that arrives late', async () => {
    await send({ steps: ['intro', 'nome', 'tipo'], answers: { tipo: 'loja' } })
    const stale = parseSessionUpdate(quiz.definition, { sid: SID, seq: 0, steps: ['intro'], answers: {} })!
    await recordVisit(fakeDb(tables), quiz, stale, context)
    expect(session().answers).toEqual({ tipo: 'loja' })
  })

  it('writes nothing for a robot', async () => {
    const outcome = await send({ steps: ['intro', 'result'], answers: ANSWERS, done: true, website: 'spam' })
    expect(outcome.done).toBe(false)
    expect(tables.quiz_sessions).toHaveLength(0)
    expect(tables.leads).toHaveLength(0)
  })
})

describe('a finished visit', () => {
  it('becomes a contact and a lead in the CRM, with the result worked out here', async () => {
    const outcome = await send({ steps: ['intro', 'contato', 'result'], answers: ANSWERS, done: true })
    expect(outcome).toMatchObject({ done: true, resultId: 'a' })

    const row = session()
    expect(row.route).toBe('A')
    expect(row.result_id).toBe('a')
    expect(row.tags).toEqual(['quiz-planejados', 'decisor:sim'])
    expect(row.lead_status).toBe('ok')

    expect(tables.contacts).toHaveLength(1)
    expect(tables.contacts[0]).toMatchObject({ account_id: 'acc-1', name: 'Ana', company: 'Planejados Silva' })
    expect(tables.leads).toHaveLength(1)
    expect(tables.leads[0]).toMatchObject({
      account_id: 'acc-1',
      source: 'quiz-moveis-planejados',
      external_id: SID,
      contact_id: tables.contacts[0].id,
    })
    expect(row.lead_id).toBe(tables.leads[0].id)
    expect(row.contact_id).toBe(tables.contacts[0].id)
    expect(tables.tags.map((t) => t.name).sort()).toEqual(['decisor:sim', 'quiz-planejados', 'rota-a'])
  })

  it('fires "lead recebido" after the answer, once', async () => {
    const outcome = await send({ steps: ['result'], answers: ANSWERS, done: true })
    expect(dispatched.calls).toHaveLength(0)
    await outcome.followUp?.()
    expect(dispatched.calls).toEqual([
      expect.objectContaining({ leadId: tables.leads[0].id, contactId: tables.contacts[0].id }),
    ])
  })

  it('cannot be told its result by the browser', async () => {
    // An architect is route C whatever else the request claims.
    const outcome = await send({
      steps: ['result'],
      answers: { ...ANSWERS, tipo: 'arquiteto' },
      done: true,
      result: 'a',
      route: 'A',
      tags: ['vip'],
    })
    expect(outcome.resultId).toBe('c')
    expect(session().route).toBe('C')
    expect(session().tags).not.toContain('vip')
  })

  it('is delivered once, however many times "done" arrives', async () => {
    await send({ steps: ['result'], answers: ANSWERS, done: true })
    const again = await send({ steps: ['result'], answers: { ...ANSWERS, tipo: 'arquiteto' }, done: true })
    expect(again).toMatchObject({ done: true, resultId: 'a', followUp: null })
    expect(tables.leads).toHaveLength(1)
    // Frozen: the later answers did not rewrite the visit.
    expect(session().route).toBe('A')
  })

  it('counts the clicks on the result button', async () => {
    await send({ steps: ['result'], answers: ANSWERS, done: true })
    await send({ cta: true })
    await send({ cta: true })
    expect(session().cta_clicks).toBe(2)
  })

  it('closes without a lead when there is no phone and no e-mail', async () => {
    const { whatsapp: _phone, ...noPhone } = ANSWERS
    void _phone
    const outcome = await send({ steps: ['result'], answers: noPhone, done: true })
    expect(outcome).toMatchObject({ done: true, followUp: null })
    expect(session().lead_status).toBe('sem_contato')
    expect(session().completed_at).not.toBeNull()
    expect(tables.leads).toHaveLength(0)
  })

  it('updates the same contact when the person answers another quiz visit', async () => {
    await send({ steps: ['result'], answers: ANSWERS, done: true })
    await send({ steps: ['result'], answers: { ...ANSWERS, empresa: 'Silva Planejados' }, done: true }, `${SID}-2`)
    expect(tables.contacts).toHaveLength(1)
    expect(tables.leads).toHaveLength(2)
  })
})
