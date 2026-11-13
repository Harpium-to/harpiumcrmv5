import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

const dispatched = vi.hoisted(() => ({ calls: [] as { leadId: string }[] }))
vi.mock('@/lib/leads/events', () => ({
  dispatchLeadReceived: async (_db: unknown, event: { leadId: string }) => {
    dispatched.calls.push(event)
  },
}))

const { sweepQuizVisits } = await import('./sweep')
const { findQuizModel } = await import('./templates')

const now = new Date('2026-11-12T15:00:00.000Z')
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

const base = findQuizModel('moveis-planejados')!.definition
const withPartial = { ...base, settings: { ...base.settings, partialLead: true } }

let tables: Record<string, Row[]> = {}

function visit(over: Row): Row {
  return {
    account_id: 'acc-1',
    quiz_id: 'quiz-on',
    steps: ['intro', 'nome', 'contato'],
    last_step: 'contato',
    answers: { primeiro_nome: 'Ana', whatsapp: '+5563912345678', empresa: 'Planejados Silva', cidade: 'Palmas / TO' },
    contact: { name: 'Ana', phone: '+5563912345678' },
    utms: { utm_campaign: 'nov' },
    meta: {},
    completed_at: null,
    partial_sent_at: null,
    lead_status: null,
    updated_at: ago(45),
    ...over,
  }
}

beforeEach(() => {
  dispatched.calls = []
  tables = {
    accounts: [{ id: 'acc-1', owner_user_id: 'owner-1' }],
    quizzes: [
      { id: 'quiz-on', account_id: 'acc-1', name: 'Quiz A', slug: 'quiz-a', published: withPartial, partial_lead: true },
      { id: 'quiz-off', account_id: 'acc-1', name: 'Quiz B', slug: 'quiz-b', published: base, partial_lead: false },
    ],
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

const run = () => sweepQuizVisits(fakeDb(tables), now)

describe('partial leads', () => {
  it('sends who left a contact and went quiet for 30 minutes, once', async () => {
    tables.quiz_sessions = [visit({ id: 'v1', sid: 'visita-0001' })]
    expect(await run()).toEqual({ partial: 1, retried: 0 })

    expect(tables.leads).toHaveLength(1)
    expect(tables.leads[0]).toMatchObject({ external_id: 'visita-0001:parcial', source: 'quiz-a' })
    expect(tables.tags.map((t) => t.name).sort()).toEqual(['quiz-incompleto', 'quiz-planejados'])
    expect(tables.quiz_sessions[0]).toMatchObject({ lead_status: 'parcial', lead_id: tables.leads[0].id })
    expect(tables.quiz_sessions[0].partial_sent_at).toBe(now.toISOString())
    expect(dispatched.calls).toHaveLength(1)

    // The next run finds nothing left to send.
    expect(await run()).toEqual({ partial: 0, retried: 0 })
    expect(tables.leads).toHaveLength(1)
  })

  it('leaves alone who is still answering, who finished and who is too old', async () => {
    tables.quiz_sessions = [
      visit({ id: 'v1', sid: 'visita-0001', updated_at: ago(10) }),
      visit({ id: 'v2', sid: 'visita-0002', completed_at: ago(40) }),
      visit({ id: 'v3', sid: 'visita-0003', updated_at: ago(60 * 30) }),
    ]
    expect(await run()).toEqual({ partial: 0, retried: 0 })
    expect(tables.leads).toHaveLength(0)
  })

  it('does not make a lead of a visit with no phone and no e-mail', async () => {
    tables.quiz_sessions = [visit({ id: 'v1', sid: 'visita-0001', contact: { name: 'Ana' } })]
    expect(await run()).toEqual({ partial: 0, retried: 0 })
    expect(tables.leads).toHaveLength(0)
    // Marked, so it is not read again every minute for a day.
    expect(tables.quiz_sessions[0].partial_sent_at).toBe(now.toISOString())
  })

  it('only for quizzes that turned it on', async () => {
    tables.quiz_sessions = [visit({ id: 'v1', sid: 'visita-0001', quiz_id: 'quiz-off' })]
    expect(await run()).toEqual({ partial: 0, retried: 0 })
    expect(tables.leads).toHaveLength(0)
    expect(tables.quiz_sessions[0].partial_sent_at).toBeNull()
  })
})

describe('retries', () => {
  it('writes again the lead of a finished visit that failed', async () => {
    tables.quiz_sessions = [
      visit({
        id: 'v1',
        sid: 'visita-0001',
        quiz_id: 'quiz-off',
        completed_at: ago(20),
        updated_at: ago(20),
        lead_status: 'erro',
        answers: {
          primeiro_nome: 'Ana',
          tipo: 'loja',
          cargo: 'dono',
          faturamento: '150a300',
          investimento: '5000a10000',
          prazo: 'ja',
          whatsapp: '+5563912345678',
          empresa: 'Planejados Silva',
          cidade: 'Palmas / TO',
        },
      }),
    ]
    expect(await run()).toEqual({ partial: 0, retried: 1 })
    expect(tables.leads).toHaveLength(1)
    expect(tables.leads[0]).toMatchObject({ external_id: 'visita-0001', source: 'quiz-b' })
    expect(tables.quiz_sessions[0].lead_status).toBe('ok')
    expect(tables.tags.map((t) => t.name)).toContain('rota-a')
  })
})

describe('sweepQuizVisits', () => {
  it('never throws, even with the database down', async () => {
    const broken = {
      from: () => {
        throw new Error('down')
      },
    } as unknown as Parameters<typeof sweepQuizVisits>[0]
    expect(await sweepQuizVisits(broken, now)).toBeNull()
  })
})
