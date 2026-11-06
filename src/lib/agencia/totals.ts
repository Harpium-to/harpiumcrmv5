// ============================================================
// Agency console totals that don't stop at 1000 rows.
//
// PostgREST caps every response at 1000 rows, so summing rows in JS
// silently undercounts once the whole portfolio passes that. Migration
// 056 counts in SQL and returns one jsonb value; before it is applied
// these fall back to paging every row with fetchAllRows — correct up
// to its 100k-row ceiling, after which it throws rather than lie.
//
// Service-role only, like the rest of src/lib/agencia.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingFunction } from '@/lib/auth/account-context'
import { fetchAllRows } from '@/lib/reports/fetch-all'

export interface AccountTotals {
  contacts: number
  openConversations: number
  openUnassigned: number
  openDeals: number
  openDealValue: number
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

const EMPTY: AccountTotals = {
  contacts: 0,
  openConversations: 0,
  openUnassigned: 0,
  openDeals: 0,
  openDealValue: 0,
}

/** Per-CRM totals. A CRM with nothing comes back as zeros, or absent. */
export async function loadAccountTotals(
  admin: SupabaseClient,
): Promise<Map<string, AccountTotals>> {
  const { data, error } = await admin.rpc('agencia_account_totals')
  if (!error) return parseAccountTotals(data)
  if (!isMissingFunction(error)) throw error

  const [contacts, conversations, deals] = await Promise.all([
    fetchAllRows<{ account_id: string }>((from, to) =>
      admin.from('contacts').select('account_id').order('id').range(from, to),
    ),
    fetchAllRows<{ account_id: string; assigned_agent_id: string | null }>((from, to) =>
      admin
        .from('conversations')
        .select('account_id, assigned_agent_id')
        .neq('status', 'closed')
        .order('id')
        .range(from, to),
    ),
    fetchAllRows<{ account_id: string; value: unknown }>((from, to) =>
      admin
        .from('deals')
        .select('account_id, value')
        .not('status', 'in', '(won,lost)')
        .order('id')
        .range(from, to),
    ),
  ])

  const out = new Map<string, AccountTotals>()
  const get = (id: string) => {
    let t = out.get(id)
    if (!t) out.set(id, (t = { ...EMPTY }))
    return t
  }
  for (const c of contacts) get(c.account_id).contacts++
  for (const c of conversations) {
    const t = get(c.account_id)
    t.openConversations++
    if (!c.assigned_agent_id) t.openUnassigned++
  }
  for (const d of deals) {
    const t = get(d.account_id)
    t.openDeals++
    t.openDealValue += n(d.value)
  }
  return out
}

export function parseAccountTotals(value: unknown): Map<string, AccountTotals> {
  const out = new Map<string, AccountTotals>()
  for (const r of Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []) {
    if (typeof r.account_id !== 'string') continue
    out.set(r.account_id, {
      contacts: n(r.contacts),
      openConversations: n(r.open_conversations),
      openUnassigned: n(r.open_unassigned),
      openDeals: n(r.open_deals),
      openDealValue: n(r.open_deal_value),
    })
  }
  return out
}

export interface MessageStats {
  /** UTC day 'YYYY-MM-DD' → counts. Days without messages are absent. */
  daily: Map<string, { incoming: number; outgoing: number }>
  /** CRM → messages since countSince (or since), and the latest one. */
  byAccount: Map<string, { messages: number; lastAt: string | null }>
}

/**
 * Messages since `since`, by UTC day and by CRM. `countSince` narrows
 * the per-CRM count (the console looks 14 days back for "went quiet"
 * but ranks on its own window).
 */
export async function loadMessageStats(
  admin: SupabaseClient,
  since: string,
  opts: { accountId?: string; countSince?: string } = {},
): Promise<MessageStats> {
  const { data, error } = await admin.rpc('agencia_message_stats', {
    p_since: since,
    p_account_id: opts.accountId ?? null,
    p_count_since: opts.countSince ?? null,
  })
  if (!error) return parseMessageStats(data)
  if (!isMissingFunction(error)) throw error

  const rows = await fetchAllRows<{
    sender_type: string
    created_at: string
    conversations: { account_id: string } | { account_id: string }[] | null
  }>((from, to) => {
    let q = admin
      .from('messages')
      .select('sender_type, created_at, conversations!inner(account_id)')
      .gte('created_at', since)
    if (opts.accountId) q = q.eq('conversations.account_id', opts.accountId)
    return q.order('id').range(from, to)
  })

  const countSince = opts.countSince ?? since
  const stats: MessageStats = { daily: new Map(), byAccount: new Map() }
  for (const m of rows) {
    const day = m.created_at.slice(0, 10)
    const bucket = stats.daily.get(day) ?? { incoming: 0, outgoing: 0 }
    if (m.sender_type === 'customer') bucket.incoming++
    else bucket.outgoing++
    stats.daily.set(day, bucket)

    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    if (!conv?.account_id) continue
    const acc = stats.byAccount.get(conv.account_id) ?? { messages: 0, lastAt: null }
    if (m.created_at >= countSince) acc.messages++
    if (!acc.lastAt || m.created_at > acc.lastAt) acc.lastAt = m.created_at
    stats.byAccount.set(conv.account_id, acc)
  }
  return stats
}

export function parseMessageStats(value: unknown): MessageStats {
  const v = (value ?? {}) as { daily?: unknown; by_account?: unknown }
  const stats: MessageStats = { daily: new Map(), byAccount: new Map() }
  for (const d of Array.isArray(v.daily) ? (v.daily as Array<Record<string, unknown>>) : []) {
    if (typeof d.day === 'string') {
      stats.daily.set(d.day, { incoming: n(d.incoming), outgoing: n(d.outgoing) })
    }
  }
  for (const a of Array.isArray(v.by_account)
    ? (v.by_account as Array<Record<string, unknown>>)
    : []) {
    if (typeof a.account_id === 'string') {
      stats.byAccount.set(a.account_id, {
        messages: n(a.messages),
        lastAt: typeof a.last_at === 'string' ? a.last_at : null,
      })
    }
  }
  return stats
}
