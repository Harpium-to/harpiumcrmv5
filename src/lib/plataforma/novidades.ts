// ============================================================
// GET /api/plataforma/v1/crms/{id}/novidades?desde=<ISO>
//
// What happened since the last look, for the cards of the agency's
// internal system (Fase 7): new leads, deals won or lost, and
// conversations that started waiting for a person. The Agency OS asks
// every 5 minutes while it is open, so there is no new webhook event,
// no trigger and no queue to keep.
//
// `desde` is clamped to 7 days back (default: 1 hour). With only
// Métricas, items carry no name or title.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CrmAccess } from './access'
import { crmLink } from './links'
import { contactNames } from './resumo'

const MAX_BACK_MS = 7 * 86_400_000
const PER_KIND = 20
const MAX_ITEMS = 50

export type NewsKind = 'lead' | 'deal_won' | 'deal_lost' | 'waiting'

export interface NewsItem {
  kind: NewsKind
  id: string
  at: string
  title: string | null
  detail: string | null
  value: number | null
  link: string
}

export function clampSince(value: string | null, now: Date): string {
  const floor = now.getTime() - MAX_BACK_MS
  const parsed = value ? Date.parse(value) : NaN
  const t = Number.isNaN(parsed) ? now.getTime() - 3_600_000 : parsed
  return new Date(Math.min(Math.max(t, floor), now.getTime())).toISOString()
}

export async function loadNovidades(
  admin: SupabaseClient,
  access: CrmAccess,
  desde: string | null,
  opts: { origin: string; now?: Date },
): Promise<{ since: string; until: string; items: NewsItem[] }> {
  const now = opts.now ?? new Date()
  const since = clampSince(desde, now)
  const until = now.toISOString()
  const accountId = access.accountId
  const named = access.level === 'rows'
  const link = (t: Parameters<typeof crmLink>[2]) => crmLink(opts.origin, accountId, t)

  const [leadsRes, dealsRes, waitingRes] = await Promise.all([
    admin
      .from('leads')
      .select('id, full_name, source, created_at')
      .eq('account_id', accountId)
      .gt('created_at', since)
      .lte('created_at', until)
      .order('created_at', { ascending: false })
      .limit(PER_KIND),
    admin
      .from('deals')
      .select('id, title, value, status, pipeline_id, closed_at')
      .eq('account_id', accountId)
      .in('status', ['won', 'lost'])
      .gt('closed_at', since)
      .lte('closed_at', until)
      .order('closed_at', { ascending: false })
      .limit(PER_KIND),
    admin
      .from('conversations')
      .select('id, contact_id, needs_human_since')
      .eq('account_id', accountId)
      .neq('status', 'closed')
      .gt('needs_human_since', since)
      .lte('needs_human_since', until)
      .order('needs_human_since', { ascending: false })
      .limit(PER_KIND),
  ])

  const leads = (leadsRes.error ? [] : (leadsRes.data ?? [])) as Array<{
    id: string
    full_name: string | null
    source: string | null
    created_at: string
  }>
  const deals = (dealsRes.error ? [] : (dealsRes.data ?? [])) as Array<{
    id: string
    title: string
    value: unknown
    status: string
    pipeline_id: string | null
    closed_at: string
  }>
  const waiting = (waitingRes.error ? [] : (waitingRes.data ?? [])) as Array<{
    id: string
    contact_id: string | null
    needs_human_since: string
  }>
  const names = named
    ? await contactNames(admin, accountId, waiting.map((w) => w.contact_id))
    : new Map<string, string | null>()

  const items: NewsItem[] = [
    ...leads.map((l) => ({
      kind: 'lead' as const,
      id: l.id,
      at: l.created_at,
      title: named ? l.full_name : null,
      detail: l.source,
      value: null,
      link: link({ kind: 'lead', id: l.id }),
    })),
    ...deals.map((d) => ({
      kind: (d.status === 'won' ? 'deal_won' : 'deal_lost') as NewsKind,
      id: d.id,
      at: d.closed_at,
      title: named ? d.title : null,
      detail: null,
      value: Number(d.value) || 0,
      link: link({ kind: 'deal', id: d.id, pipelineId: d.pipeline_id }),
    })),
    ...waiting.map((w) => ({
      kind: 'waiting' as const,
      id: w.id,
      at: w.needs_human_since,
      title: named && w.contact_id ? (names.get(w.contact_id) ?? null) : null,
      detail: null,
      value: null,
      link: link({ kind: 'conversation', id: w.id }),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_ITEMS)

  return { since, until, items }
}
