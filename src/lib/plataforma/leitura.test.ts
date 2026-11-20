import { describe, expect, it } from 'vitest'

import { safeNextPath } from '@/lib/http/next-path'

import type { CrmAccess } from './access'
import { loadCarteira } from './carteira'
import { loadFunil } from './funil'
import { crmLink } from './links'
import { recordingDb, type Row } from './recording-db.test-helper'
import { loadResumo } from './resumo'

const ACC = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ORIGIN = 'https://crm.test'
const NOW = new Date('2026-11-20T15:00:00Z')
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()

// Personal data that must never leave the server at the metrics level.
const SECRETS = ['Ana Secreta', '+5563999990000', 'ana@secreta.com', 'Bruno Oculto', 'Reunião com Bruno']

function world(): Record<string, Row[]> {
  const both = (rows: Row[]) => [
    ...rows.map((r) => ({ ...r, account_id: ACC })),
    ...rows.map((r) => ({ ...r, id: `${r.id}-o`, account_id: OTHER })),
  ]
  return {
    accounts: [
      { id: ACC, name: 'Harpium Digital', status: 'active', default_currency: 'BRL', created_at: iso(200) },
      { id: OTHER, name: 'Outro cliente', status: 'active', default_currency: 'BRL', created_at: iso(200) },
    ],
    leads: both([
      {
        id: 'l1',
        source: 'quiz-planejados',
        full_name: 'Ana Secreta',
        email: 'ana@secreta.com',
        phone: '+5563999990000',
        campaign: 'planejados-nov',
        raw: { origem: 'quiz-planejados', nome: 'Ana Secreta', rota: 'A' },
        created_at: iso(2),
      },
      { id: 'l2', source: 'meta', full_name: 'Bruno Oculto', raw: {}, created_at: iso(5) },
      { id: 'l3', source: 'meta', full_name: 'Velho', raw: {}, created_at: iso(45) },
    ]),
    contacts: both([
      { id: 'c1', name: 'Ana Secreta', phone: '+5563999990000', created_at: iso(2) },
      { id: 'c2', name: 'Bruno Oculto', phone: '+5563988887777', created_at: iso(100) },
    ]),
    conversations: both([
      { id: 'v1', contact_id: 'c1', status: 'open', assigned_agent_id: null, needs_human_since: iso(0.05), created_at: iso(1) },
      { id: 'v2', contact_id: 'c2', status: 'pending', assigned_agent_id: 'u1', needs_human_since: null, created_at: iso(40) },
    ]),
    deals: both([
      { id: 'd1', title: 'Plano anual', value: 4800, status: 'open', stage_id: 's1', pipeline_id: 'p1', contact_id: 'c1', updated_at: iso(1) },
      { id: 'd2', title: 'Site', value: '1500.5', status: 'won', closed_at: iso(3), stage_id: 's2', pipeline_id: 'p1', contact_id: 'c2' },
      { id: 'd3', title: 'Perdido', value: 900, status: 'lost', closed_at: iso(4), stage_id: 's2', pipeline_id: 'p1', contact_id: 'c2' },
    ]),
    pipelines: both([{ id: 'p1', name: 'Vendas', created_at: iso(300) }]),
    pipeline_stages: [
      { id: 's1', pipeline_id: 'p1', name: 'Proposta', color: '#f59e0b', position: 1 },
      { id: 's2', pipeline_id: 'p1', name: 'Fechado', color: '#10b981', position: 2 },
    ],
    contact_tasks: both([
      { id: 't1', title: 'Ligar para a Ana', contact_id: 'c1', due_at: iso(1), done_at: null, assigned_to: 'u1' },
      { id: 't2', title: 'Feita', contact_id: 'c1', due_at: iso(1), done_at: iso(0.5) },
    ]),
    calendar_events: both([
      { id: 'e1', title: 'Reunião com Bruno', kind: 'appointment', status: 'scheduled', calendar_id: 'k1', contact_id: 'c2', starts_at: new Date(NOW.getTime() + 2 * 86_400_000).toISOString() },
      { id: 'e2', title: 'Cancelada', kind: 'appointment', status: 'cancelled', calendar_id: 'k1', starts_at: new Date(NOW.getTime() + 86_400_000).toISOString() },
    ]),
    calendars: both([{ id: 'k1', name: 'Comercial' }]),
    automations: both([
      { id: 'a1', is_active: true },
      { id: 'a2', is_active: false },
    ]),
    agents: both([{ id: 'g1', is_active: true }]),
    account_members: [
      { account_id: ACC, user_id: 'u1', role: 'owner' },
      { account_id: OTHER, user_id: 'u2', role: 'owner' },
    ],
    instagram_config: [{ account_id: ACC, enabled: true, ig_user_id: '123' }],
    whatsapp_config: [],
    uazapi_config: [],
    profiles: [{ user_id: 'u1', full_name: 'Marcelo', email: 'm@h.com' }],
  }
}

const rpcs = {
  agencia_message_stats: (a: Record<string, unknown>) => {
    expect(a.p_account_id).toBe(ACC)
    return { daily: [{ day: '2026-11-19', incoming: 7, outgoing: 9 }], by_account: [] }
  },
  report_first_response: (a: Record<string, unknown>) => {
    expect(a.p_account_id).toBe(ACC)
    return { replied: 10, unreplied: 2, median_seconds: 720 }
  },
}

const access = (level: 'rows' | 'metrics'): CrmAccess => ({
  accountId: ACC,
  name: 'Harpium Digital',
  status: 'active',
  level,
  via: 'agency',
  role: level === 'rows' ? 'viewer' : null,
  consent: level === 'rows' ? 'read' : 'metrics',
})

// Tables that hold one CRM's data: every read must name the CRM.
const SCOPED = [
  'leads',
  'contacts',
  'conversations',
  'deals',
  'contact_tasks',
  'calendar_events',
  'automations',
  'agents',
  'account_members',
  'pipelines',
  'calendars',
  'instagram_config',
]

function expectScoped(log: { table: string; filters: Array<[string, string, unknown]> }[]) {
  const reads = log.filter((q) => SCOPED.includes(q.table))
  expect(reads.length).toBeGreaterThan(0)
  for (const q of reads) {
    const scoped = q.filters.some(([op, col, v]) => op === 'eq' && col === 'account_id' && v === ACC)
    expect({ table: q.table, scoped }).toEqual({ table: q.table, scoped: true })
  }
}

describe('loadResumo', () => {
  it('counts only the CRM asked for, and every read names it', async () => {
    const { db, log } = recordingDb(world(), rpcs)
    const s = await loadResumo(db, access('rows'), 30, { origin: ORIGIN, now: NOW })

    expect(s.leads.total).toBe(2)
    expect(s.leads.previous).toBe(1)
    expect(s.leads.byOrigin).toEqual([
      { origin: 'meta', count: 1 },
      { origin: 'quiz-planejados', count: 1 },
    ])
    expect(s.contacts).toEqual({ total: 2, new: 1 })
    expect(s.conversations).toMatchObject({ open: 1, pending: 1, waitingHuman: 1, unassigned: 1 })
    expect(s.messages).toEqual({ incoming: 7, outgoing: 9 })
    expect(s.firstResponse).toEqual({ medianMinutes: 12, replied: 10, unreplied: 2 })
    expect(s.deals).toMatchObject({
      openCount: 1,
      openValue: 4800,
      wonCount: 1,
      wonValue: 1500.5,
      lostCount: 1,
      conversion: 0.5,
    })
    expect(s.tasks.open).toBe(1)
    expect(s.tasks.overdue).toBe(1)
    expect(s.agenda.next7Days).toBe(1)
    expect(s.automations).toEqual({ active: 1, total: 2 })
    expect(s.agents).toEqual({ active: 1, total: 1 })
    expect(s.channels.instagram).toBe('connected')
    expect(s.team.members).toBe(1)
    expectScoped(log)
  })

  it('with Leitura, brings the short lists with links that open the CRM', async () => {
    const { db } = recordingDb(world(), rpcs)
    const s = await loadResumo(db, access('rows'), 30, { origin: ORIGIN, now: NOW })
    expect(s.lists?.recentLeads[0]).toMatchObject({
      id: 'l1',
      name: 'Ana Secreta',
      origin: 'quiz-planejados',
      link: crmLink(ORIGIN, ACC, { kind: 'lead', id: 'l1' }),
    })
    expect(s.lists?.waitingConversations[0]).toMatchObject({ id: 'v1', contactName: 'Ana Secreta' })
    expect(s.lists?.hotDeals[0]).toMatchObject({ title: 'Plano anual', stage: 'Proposta', pipeline: 'Vendas' })
    expect(s.lists?.overdueTasks[0]).toMatchObject({ title: 'Ligar para a Ana', assignee: 'Marcelo' })
    expect(s.lists?.upcomingEvents).toHaveLength(1)
    expect(s.lists?.upcomingEvents[0]).toMatchObject({ calendar: 'Comercial', contactName: 'Bruno Oculto' })
    for (const l of [s.links.abrir, s.lists!.recentLeads[0].link]) {
      expect(l.startsWith(`${ORIGIN}/abrir?crm=${ACC}&ir=`)).toBe(true)
    }
  })

  it('with only Métricas, nothing personal leaves the server', async () => {
    const { db } = recordingDb(world(), rpcs)
    const s = await loadResumo(db, access('metrics'), 30, { origin: ORIGIN, now: NOW })
    expect(s.lists).toBeNull()
    expect(s.leads.total).toBe(2)
    const json = JSON.stringify(s)
    for (const secret of SECRETS) expect(json).not.toContain(secret)
  })
})

describe('loadFunil', () => {
  it('counts every stage; cards only with Leitura', async () => {
    const { db, log } = recordingDb(world(), rpcs)
    const rows = await loadFunil(db, access('rows'), { origin: ORIGIN })
    const [p] = rows.pipelines
    expect(p.name).toBe('Vendas')
    expect(p.stages.map((s) => [s.name, s.count, s.value])).toEqual([
      ['Proposta', 1, 4800],
      ['Fechado', 0, 0],
    ])
    expect(p.stages[0].deals?.[0]).toMatchObject({ title: 'Plano anual', contactName: 'Ana Secreta' })
    expectScoped(log)

    const metrics = await loadFunil(recordingDb(world(), rpcs).db, access('metrics'), { origin: ORIGIN })
    expect(metrics.pipelines[0].stages[0].deals).toBeNull()
    expect(JSON.stringify(metrics)).not.toContain('Ana Secreta')
  })
})

describe('loadCarteira', () => {
  it('someone outside the agency sees only the CRMs they are a member of', async () => {
    const { db } = recordingDb(world(), rpcs)
    const rows = await loadCarteira(
      db,
      { userId: 'u1', email: 'm@h.com', name: null, agencyRole: null },
      { origin: ORIGIN, now: NOW },
    )
    expect(rows.map((r) => [r.id, r.memberRole, r.via])).toEqual([[ACC, 'owner', 'member']])
    expect(rows[0].links.abrir.startsWith(`${ORIGIN}/abrir?crm=${ACC}`)).toBe(true)
  })
})

describe('safeNextPath', () => {
  it('keeps known same-site paths and refuses everything else', () => {
    expect(safeNextPath('/pipelines?deal=1')).toBe('/pipelines?deal=1')
    expect(safeNextPath('/agencia/abc')).toBe('/agencia/abc')
    for (const bad of [
      '//evil.com',
      'https://evil.com',
      '/\\evil.com',
      'javascript:alert(1)',
      '/dashboardx',
      '/api/v1/contacts',
      '/abrir?crm=1',
      '/in\nbox',
      '',
      null,
    ]) {
      expect(safeNextPath(bad)).toBe('/dashboard')
    }
  })
})
