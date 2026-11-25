import { describe, expect, it } from 'vitest'

import {
  CONNECT_TOKEN,
  claimConnectLink,
  connectLinkMessage,
  connectLinkUrl,
  createConnectLink,
  findUsableConnectLink,
  hashConnectToken,
} from './connect-links'

// ---------------------------------------------------------------------
// A tiny in-memory whatsapp_connect_links, enough for the query shapes
// the module uses (eq / is null / gt / update … select).
// ---------------------------------------------------------------------
type Row = Record<string, unknown>

function fakeDb(rows: Row[] = []) {
  const db = {
    rows,
    from() {
      type Filter = (r: Row) => boolean
      const filters: Filter[] = []
      let patch: Row | null = null
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
        order: () => q,
        limit: () => q,
        update: (p: Row) => ((patch = p), q),
        insert: async (r: Row) => {
          rows.push({ id: `id-${rows.length + 1}`, used_at: null, revoked_at: null, ...r })
          return { error: null }
        },
        maybeSingle: async () => {
          const hit = rows.filter((r) => filters.every((f) => f(r)))[0] ?? null
          return { data: hit && { ...hit, accounts: { name: 'Clínica Sol' } }, error: null }
        },
        then: (resolve: (v: unknown) => void) => {
          const hit = rows.filter((r) => filters.every((f) => f(r)))
          if (patch) hit.forEach((r) => Object.assign(r, patch))
          resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
        },
      }
      return q
    },
  }
  return db
}
const asDb = (d: ReturnType<typeof fakeDb>) => d as never

const NOW = new Date('2026-11-25T12:00:00Z')

describe('connect links', () => {
  it('stores only the hash and opens with the plaintext token', async () => {
    const db = fakeDb()
    const { token, expiresAt } = await createConnectLink(asDb(db), {
      accountId: 'acc-1',
      createdBy: 'u-1',
      via: 'crm',
      now: NOW,
    })
    expect(CONNECT_TOKEN.test(token)).toBe(true)
    expect(expiresAt).toBe('2026-12-02T12:00:00.000Z')
    expect(JSON.stringify(db.rows)).not.toContain(token)
    expect(db.rows[0].token_hash).toBe(hashConnectToken(token))

    const link = await findUsableConnectLink(asDb(db), token, NOW)
    expect(link).toEqual({ id: 'id-1', accountId: 'acc-1', createdBy: 'u-1', crmName: 'Clínica Sol' })
  })

  it('a new link cancels the open one', async () => {
    const db = fakeDb()
    const first = await createConnectLink(asDb(db), { accountId: 'acc-1', createdBy: 'u', via: 'crm', now: NOW })
    const second = await createConnectLink(asDb(db), { accountId: 'acc-1', createdBy: 'u', via: 'agencia', now: NOW })
    expect(await findUsableConnectLink(asDb(db), first.token, NOW)).toBeNull()
    expect(await findUsableConnectLink(asDb(db), second.token, NOW)).not.toBeNull()
  })

  it('expires after 7 days', async () => {
    const db = fakeDb()
    const { token } = await createConnectLink(asDb(db), { accountId: 'acc-1', createdBy: 'u', via: 'crm', now: NOW })
    const later = new Date(NOW.getTime() + 7 * 86_400_000 + 1000)
    expect(await findUsableConnectLink(asDb(db), token, later)).toBeNull()
  })

  it('serves one connection: only the first claim wins', async () => {
    const db = fakeDb()
    const { token } = await createConnectLink(asDb(db), { accountId: 'acc-1', createdBy: 'u', via: 'crm', now: NOW })
    const link = await findUsableConnectLink(asDb(db), token, NOW)
    expect(await claimConnectLink(asDb(db), link!.id, NOW)).toBe(true)
    expect(await claimConnectLink(asDb(db), link!.id, NOW)).toBe(false)
    expect(await findUsableConnectLink(asDb(db), token, NOW)).toBeNull()
  })

  it('ignores malformed and unknown tokens', async () => {
    const db = fakeDb()
    expect(await findUsableConnectLink(asDb(db), 'abc', NOW)).toBeNull()
    expect(await findUsableConnectLink(asDb(db), 'x'.repeat(43), NOW)).toBeNull()
  })

  it('builds the link and the message', () => {
    const url = connectLinkUrl('https://crm.harpium.com.br/', 'TOKEN')
    expect(url).toBe('https://crm.harpium.com.br/conectar-whatsapp/TOKEN')
    const msg = connectLinkMessage(url, 'Clínica Sol')
    expect(msg).toContain('ao CRM Clínica Sol')
    expect(msg).toContain('Não precisa de login')
    expect(msg).toContain(url)
  })
})
