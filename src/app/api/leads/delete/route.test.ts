import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

// ---------------------------------------------------------------------
// The route only adds the gate (admins) and the account scope to
// lib/leads/delete, which has its own tests. Pinned here: a non-admin
// deletes nothing, the preview deletes nothing, and the account comes
// from the session, never from the body.
// ---------------------------------------------------------------------

class Forbidden extends Error {
  status = 403
}

let tables: Record<string, Row[]> = {}
let role: 'admin' | 'agent' = 'admin'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    if (role !== 'admin') throw new Forbidden('Apenas administradores')
    return { accountId: 'acc-1', userId: 'user-1' }
  }),
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), {
      status: err instanceof Forbidden ? 403 : 500,
    }),
}))

vi.mock('@/lib/leads/admin-client', () => ({
  supabaseAdmin: () => fakeDb(tables),
}))

import { POST } from './route'

function call(body: unknown) {
  return POST(
    new Request('http://localhost/api/leads/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  role = 'admin'
  tables = {
    leads: [
      { id: 'lead-1', account_id: 'acc-1', contact_id: 'c-1', created_at: '2026-11-12T10:00:01.000Z' },
      { id: 'lead-x', account_id: 'acc-2', contact_id: null, created_at: '2026-11-12T10:00:01.000Z' },
    ],
    contacts: [{ id: 'c-1', account_id: 'acc-1', name: 'Teste', created_at: '2026-11-12T10:00:00.000Z' }],
    deals: [{ id: 'd-1', account_id: 'acc-1', contact_id: 'c-1' }],
    conversations: [],
    messages: [],
    contact_notes: [],
  }
})

describe('POST /api/leads/delete', () => {
  it('refuses a non-admin and deletes nothing', async () => {
    role = 'agent'
    const res = await call({ ids: ['lead-1'], delete_contacts: true })
    expect(res.status).toBe(403)
    expect(tables.leads).toHaveLength(2)
    expect(tables.contacts).toHaveLength(1)
  })

  it('asks for at least one lead', async () => {
    const res = await call({ ids: [] })
    expect(res.status).toBe(400)
  })

  it('preview names the test contact and deletes nothing', async () => {
    const res = await call({ ids: ['lead-1'], preview: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      leads: 1,
      test_contacts: [{ contact_id: 'c-1', name: 'Teste', lead_ids: ['lead-1'] }],
    })
    expect(tables.leads).toHaveLength(2)
    expect(tables.contacts).toHaveLength(1)
  })

  it('deletes the lead and keeps the contact unless asked', async () => {
    const res = await call({ ids: ['lead-1'] })
    expect(await res.json()).toEqual({
      ok: true,
      leads_deleted: 1,
      contacts_deleted: 0,
      contacts_failed: 0,
    })
    expect(tables.leads.map((l) => l.id)).toEqual(['lead-x'])
    expect(tables.contacts).toHaveLength(1)
  })

  it('deletes the test contact and its card when asked', async () => {
    const res = await call({ ids: ['lead-1'], delete_contacts: true })
    expect((await res.json()).contacts_deleted).toBe(1)
    expect(tables.contacts).toHaveLength(0)
    expect(tables.deals).toHaveLength(0)
  })

  it('cannot reach another account by id', async () => {
    const res = await call({ ids: ['lead-x'] })
    expect((await res.json()).leads_deleted).toBe(0)
    expect(tables.leads.map((l) => l.id)).toContain('lead-x')
  })
})
