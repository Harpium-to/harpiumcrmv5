import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// What a duplicated agent inherits — and, more to the point, what it must
// not. Three of those exclusions are load-bearing and invisible from the
// screen: a copy that kept `is_fallback` would quietly take over the
// account's unmatched inbound, a copy that kept `is_active` would start
// answering customers with the original's script before anyone read it,
// and a copy that kept `status` / `cost_usd` would report itself mid-
// conversation having spent money it never spent.
//
// These are exactly the kind of fields that get added back by a later
// "just spread the row" refactor, so they are pinned here.
// ---------------------------------------------------------------------------

const inserts: Array<Record<string, unknown>> = []
const eqCalls: Array<[string, unknown]> = []
let sourceRow: Record<string, unknown> | null = null
let readError: unknown = null
let insertError: unknown = null

/** Column defaults the database would apply, for mapAgentRow's benefit. */
const ROW_DEFAULTS = {
  id: 'agent-copy',
  account_id: 'acct-1',
  status: 'idle',
  status_detail: null,
  status_changed_at: '2026-01-01T00:00:00.000Z',
  cost_usd: '0',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function makeSupabaseMock() {
  return {
    from() {
      let payload: Record<string, unknown> | null = null
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (column: string, value: unknown) => {
        eqCalls.push([column, value])
        return b
      }
      b.insert = (values: Record<string, unknown>) => {
        payload = values
        inserts.push(values)
        return b
      }
      b.maybeSingle = async () => ({ data: sourceRow, error: readError })
      b.single = async () => ({
        data: payload ? { ...ROW_DEFAULTS, ...payload } : null,
        error: insertError,
      })
      return b
    },
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: supabaseMock,
    accountId: 'acct-1',
    userId: 'user-1',
  })),
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 403 }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: () => new Response('slow down', { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

import { POST } from './route'

/** Everything `COPIED_COLUMNS` reads, as the source row would come back. */
const SOURCE = {
  name: 'Clara',
  role: 'closer',
  avatar_url: 'https://example.test/clara.png',
  objective: 'Fechar os negócios que chegam na reta final',
  autonomy: 3,
  tools: ['messaging', 'pipeline'],
  channels: ['whatsapp'],
  require_approval_for: ['give_discount'],
  work_days: [1, 2, 3, 4, 5],
  work_start: '09:00:00',
  work_end: '18:00:00',
  timezone: 'America/Sao_Paulo',
  goals: { closes_per_month: 10 },
  department: 'vendas',
  system_prompt: 'Você é a closer da operação.',
  model: 'claude-opus-5',
  keywords: ['proposta', 'contrato'],
  priority: 70,
  max_replies_per_conversation: 5,
  handoff_agent_id: 'user-9',
}

function duplicate(id = 'agent-1') {
  return POST(new Request('http://localhost/api/agents/agent-1/duplicate', { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })
}

describe('POST /api/agents/:id/duplicate', () => {
  beforeEach(() => {
    inserts.length = 0
    eqCalls.length = 0
    sourceRow = { ...SOURCE }
    readError = null
    insertError = null
    supabaseMock = makeSupabaseMock()
  })

  it('copies the whole configuration unchanged', async () => {
    const res = await duplicate()
    expect(res.status).toBe(201)
    expect(inserts).toHaveLength(1)

    const { name, ...config } = SOURCE
    expect(name).toBe('Clara')
    expect(inserts[0]).toMatchObject(config)
  })

  it('marks the copy in its name', async () => {
    await duplicate()
    expect(inserts[0]!.name).toBe('Clara (cópia)')
  })

  it('keeps the marker on a name already at the limit', async () => {
    sourceRow = { ...SOURCE, name: 'C'.repeat(80) }
    await duplicate()
    const copied = inserts[0]!.name as string
    expect(copied.endsWith(' (cópia)')).toBe(true)
    expect(copied.length).toBeLessThanOrEqual(80)
  })

  it('never hands the account default to a copy', async () => {
    // The partial unique index allows one per account; inheriting the
    // flag would either bounce off it or move the default silently.
    sourceRow = { ...SOURCE, is_fallback: true }
    await duplicate()
    expect(inserts[0]!.is_fallback).toBe(false)
  })

  it('arrives switched off', async () => {
    sourceRow = { ...SOURCE, is_active: true }
    await duplicate()
    expect(inserts[0]!.is_active).toBe(false)
  })

  it('carries over no operational history', async () => {
    sourceRow = {
      ...SOURCE,
      status: 'talking',
      status_detail: 'respondendo a Maria',
      cost_usd: '12.480000',
    }
    await duplicate()
    const payload = inserts[0]!
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('status_detail')
    expect(payload).not.toHaveProperty('status_changed_at')
    expect(payload).not.toHaveProperty('cost_usd')
  })

  it('lets the database mint the new id and records who copied it', async () => {
    await duplicate()
    expect(inserts[0]).not.toHaveProperty('id')
    expect(inserts[0]).toMatchObject({
      account_id: 'acct-1',
      created_by: 'user-1',
    })
  })

  it('scopes the read to the caller account', async () => {
    await duplicate('agent-from-another-tenant')
    expect(eqCalls).toContainEqual(['id', 'agent-from-another-tenant'])
    expect(eqCalls).toContainEqual(['account_id', 'acct-1'])
  })

  it('404s instead of inserting when the agent is not the caller\'s', async () => {
    sourceRow = null
    const res = await duplicate()
    expect(res.status).toBe(404)
    expect(inserts).toHaveLength(0)
  })

  it('does not insert when the read fails', async () => {
    readError = { message: 'boom' }
    const res = await duplicate()
    expect(res.status).toBe(500)
    expect(inserts).toHaveLength(0)
  })

  it('reports a failed insert rather than a phantom agent', async () => {
    insertError = { message: 'boom' }
    const res = await duplicate()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toHaveProperty('error')
  })
})
