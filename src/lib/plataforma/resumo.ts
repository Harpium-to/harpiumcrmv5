// ============================================================
// GET /api/plataforma/v1/crms/{id}/resumo — the operation of one CRM,
// seen from above (docs/plano-integracao-agency-os.md §5.4).
//
// ⚠️ Every query here runs with the SERVICE ROLE, so RLS does not
// separate the CRMs: each one filters `account_id` itself. Do NOT reuse
// src/lib/dashboard/queries.ts or loadReportBundle here — they rely on
// RLS and would sum every client. `messages` has no account_id: it goes
// through agencia_message_stats (056), which filters the CRM.
//
// Two levels (access.ts):
//   metrics → numbers only; `lists` is null. No name, phone, e-mail or
//             message text may appear anywhere in the answer.
//   rows    → the numbers plus five short lists, each item with a link.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTeamQueues } from '@/lib/agencia/atendimento'

import { loadPlatformUsage } from '@/lib/agencia/crms'
import { computeAlerts, computeHealth, type HealthBand } from '@/lib/agencia/health'
import { loadMessageStats } from '@/lib/agencia/totals'
import { loadWhatsAppStatuses } from '@/lib/agencia/whatsapp'
import { normalizeLead } from '@/lib/leads/parse'
import { fetchAllRows } from '@/lib/reports/fetch-all'

import type { CrmAccess } from './access'
import { crmLink, pageLinks, type CrmPageLinks } from './links'

const DAY = 86_400_000
const LIST_SIZE = 10
const TOP_ORIGINS = 8

export const SUMMARY_WINDOWS = [7, 30, 90] as const
export type SummaryWindow = (typeof SUMMARY_WINDOWS)[number]

export function parseSummaryWindow(value: string | null): SummaryWindow {
  const n = Number(value)
  return (SUMMARY_WINDOWS as readonly number[]).includes(n) ? (n as SummaryWindow) : 30
}

type ChannelState = 'connected' | 'attention' | 'none'

export interface CrmSummary {
  crm: {
    id: string
    name: string
    status: string
    access: 'rows' | 'metrics'
    consent: string | null
    currency: string
    health: { score: number; band: HealthBand; trend: 'up' | 'down' | 'flat' } | null
  }
  window: { days: number; since: string; until: string }
  leads: {
    total: number
    previous: number | null
    byOrigin: { origin: string; count: number }[]
    byDay: { day: string; count: number }[]
  }
  contacts: { total: number | null; new: number | null }
  conversations: {
    open: number | null
    pending: number | null
    waitingHuman: number | null
    unassigned: number | null
    new: number | null
  }
  messages: { incoming: number; outgoing: number } | null
  firstResponse: { medianMinutes: number | null; replied: number; unreplied: number } | null
  deals: {
    openCount: number
    openValue: number
    wonCount: number
    wonValue: number
    lostCount: number
    lostValue: number
    conversion: number | null
  }
  tasks: { open: number | null; overdue: number | null; dueToday: number | null }
  agenda: { today: number | null; next7Days: number | null }
  automations: { active: number; total: number } | null
  agents: { active: number; total: number } | null
  channels: { whatsapp: ChannelState; whatsappReason: string | null; instagram: ChannelState }
  team: { members: number | null; activeUsers7d: number | null; lastActivityAt: string | null }
  alerts: { kind: string; label: string }[]
  /** Setores (077/078): their queues and deadlines. [] when the CRM has none. */
  teams: { name: string; members: number; queued: number; waiting: number; overdue: number }[]
  lists: SummaryLists | null
  links: CrmPageLinks
  generatedAt: string
}

export interface SummaryLists {
  recentLeads: {
    id: string
    name: string | null
    origin: string | null
    campaign: string | null
    route: string | null
    createdAt: string
    link: string
  }[]
  waitingConversations: {
    id: string
    contactName: string | null
    waitingSince: string | null
    assigned: boolean
    link: string
  }[]
  hotDeals: {
    id: string
    title: string
    value: number
    stage: string | null
    pipeline: string | null
    contactName: string | null
    updatedAt: string | null
    link: string
  }[]
  overdueTasks: {
    id: string
    title: string
    dueAt: string | null
    assignee: string | null
    contactName: string | null
    link: string
  }[]
  upcomingEvents: {
    id: string
    title: string | null
    startsAt: string
    calendar: string | null
    contactName: string | null
    link: string
  }[]
}

const num = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Start of the day in Brasília, as an instant. */
export function brtDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() - 3 * 3_600_000)
  const ymd = shifted.toISOString().slice(0, 10)
  return new Date(`${ymd}T00:00:00-03:00`)
}

type CountQuery = PromiseLike<{ count: number | null; error: unknown }>

/** A head count, or null when the table/column is not there. */
async function count(q: CountQuery): Promise<number | null> {
  const { count: c, error } = await q
  if (error) return null
  return c ?? 0
}

export async function loadResumo(
  admin: SupabaseClient,
  access: CrmAccess,
  days: SummaryWindow,
  opts: { origin: string; now?: Date },
): Promise<CrmSummary> {
  const accountId = access.accountId
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const since = new Date(now.getTime() - days * DAY).toISOString()
  const prevSince = new Date(now.getTime() - 2 * days * DAY).toISOString()
  const todayStart = brtDayStart(now)
  const tomorrowStart = new Date(todayStart.getTime() + DAY)
  const in7Days = new Date(now.getTime() + 7 * DAY).toISOString()

  const head = { count: 'exact' as const, head: true }

  const [
    accountRes,
    leadRows,
    leadsPrev,
    contactsTotal,
    contactsNew,
    convOpen,
    convPending,
    convWaiting,
    convUnassigned,
    convNew,
    messages,
    firstResponseRes,
    openDeals,
    closedDeals,
    tasksOpen,
    tasksOverdue,
    tasksToday,
    eventsToday,
    eventsNext,
    automationsTotal,
    automationsActive,
    agentsTotal,
    agentsActive,
    whatsapp,
    instagramRes,
    usage,
    membersCount,
  ] = await Promise.all([
    admin
      .from('accounts')
      .select('default_currency, status, status_changed_at, created_at')
      .eq('id', accountId)
      .maybeSingle(),
    fetchAllRows<{ id: string; source: string | null; created_at: string }>((from, to) =>
      admin
        .from('leads')
        .select('id, source, created_at')
        .eq('account_id', accountId)
        .gte('created_at', since)
        .order('id')
        .range(from, to),
    ).catch(() => [] as { id: string; source: string | null; created_at: string }[]),
    count(
      admin
        .from('leads')
        .select('id', head)
        .eq('account_id', accountId)
        .gte('created_at', prevSince)
        .lt('created_at', since),
    ),
    count(admin.from('contacts').select('id', head).eq('account_id', accountId)),
    count(
      admin.from('contacts').select('id', head).eq('account_id', accountId).gte('created_at', since),
    ),
    count(admin.from('conversations').select('id', head).eq('account_id', accountId).eq('status', 'open')),
    count(
      admin.from('conversations').select('id', head).eq('account_id', accountId).eq('status', 'pending'),
    ),
    count(
      admin
        .from('conversations')
        .select('id', head)
        .eq('account_id', accountId)
        .neq('status', 'closed')
        .not('needs_human_since', 'is', null),
    ),
    count(
      admin
        .from('conversations')
        .select('id', head)
        .eq('account_id', accountId)
        .eq('status', 'open')
        .is('assigned_agent_id', null),
    ),
    count(
      admin
        .from('conversations')
        .select('id', head)
        .eq('account_id', accountId)
        .gte('created_at', since),
    ),
    loadMessageStats(admin, since, { accountId }).catch(() => null),
    admin.rpc('report_first_response', {
      p_account_id: accountId,
      p_from: since,
      p_to: nowIso,
      p_timezone: 'America/Sao_Paulo',
    }),
    fetchAllRows<{ value: unknown }>((from, to) =>
      admin
        .from('deals')
        .select('value')
        .eq('account_id', accountId)
        .eq('status', 'open')
        .order('id')
        .range(from, to),
    ).catch(() => [] as { value: unknown }[]),
    fetchAllRows<{ status: string; value: unknown }>((from, to) =>
      admin
        .from('deals')
        .select('status, value')
        .eq('account_id', accountId)
        .in('status', ['won', 'lost'])
        .gte('closed_at', since)
        .order('id')
        .range(from, to),
    ).catch(() => [] as { status: string; value: unknown }[]),
    count(
      admin.from('contact_tasks').select('id', head).eq('account_id', accountId).is('done_at', null),
    ),
    count(
      admin
        .from('contact_tasks')
        .select('id', head)
        .eq('account_id', accountId)
        .is('done_at', null)
        .lt('due_at', nowIso),
    ),
    count(
      admin
        .from('contact_tasks')
        .select('id', head)
        .eq('account_id', accountId)
        .is('done_at', null)
        .gte('due_at', todayStart.toISOString())
        .lt('due_at', tomorrowStart.toISOString()),
    ),
    count(
      admin
        .from('calendar_events')
        .select('id', head)
        .eq('account_id', accountId)
        .eq('kind', 'appointment')
        .not('status', 'in', '(cancelled)')
        .gte('starts_at', todayStart.toISOString())
        .lt('starts_at', tomorrowStart.toISOString()),
    ),
    count(
      admin
        .from('calendar_events')
        .select('id', head)
        .eq('account_id', accountId)
        .eq('kind', 'appointment')
        .not('status', 'in', '(cancelled)')
        .gte('starts_at', nowIso)
        .lt('starts_at', in7Days),
    ),
    count(admin.from('automations').select('id', head).eq('account_id', accountId)),
    count(
      admin.from('automations').select('id', head).eq('account_id', accountId).eq('is_active', true),
    ),
    count(admin.from('agents').select('id', head).eq('account_id', accountId)),
    count(admin.from('agents').select('id', head).eq('account_id', accountId).eq('is_active', true)),
    loadWhatsAppStatuses(admin).catch(() => null),
    admin.from('instagram_config').select('enabled, ig_user_id').eq('account_id', accountId).maybeSingle(),
    loadPlatformUsage(admin).catch(() => null),
    count(admin.from('account_members').select('user_id', head).eq('account_id', accountId)),
  ])

  const account = (accountRes.data ?? null) as {
    default_currency?: string | null
    status?: string | null
    status_changed_at?: string | null
    created_at?: string | null
  } | null

  // ---- leads ----
  const byOriginMap = new Map<string, number>()
  const byDayMap = new Map<string, number>()
  for (const l of leadRows) {
    const origin = l.source || 'other'
    byOriginMap.set(origin, (byOriginMap.get(origin) ?? 0) + 1)
    const day = new Date(new Date(l.created_at).getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
    byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1)
  }
  const byOrigin = [...byOriginMap.entries()]
    .map(([origin, c]) => ({ origin, count: c }))
    .sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin))
    .slice(0, TOP_ORIGINS)
  const byDay = [...byDayMap.entries()]
    .map(([day, c]) => ({ day, count: c }))
    .sort((a, b) => a.day.localeCompare(b.day))

  // ---- messages ----
  let messageTotals: CrmSummary['messages'] = null
  if (messages) {
    let incoming = 0
    let outgoing = 0
    for (const d of messages.daily.values()) {
      incoming += d.incoming
      outgoing += d.outgoing
    }
    messageTotals = { incoming, outgoing }
  }

  // ---- first response ----
  let firstResponse: CrmSummary['firstResponse'] = null
  if (!firstResponseRes.error && firstResponseRes.data) {
    const raw = firstResponseRes.data as {
      replied?: unknown
      unreplied?: unknown
      median_seconds?: unknown
    }
    const median = raw.median_seconds === null || raw.median_seconds === undefined
      ? null
      : Math.round(num(raw.median_seconds) / 6) / 10
    firstResponse = { medianMinutes: median, replied: num(raw.replied), unreplied: num(raw.unreplied) }
  }

  // ---- deals ----
  let wonCount = 0
  let wonValue = 0
  let lostCount = 0
  let lostValue = 0
  for (const d of closedDeals) {
    if (d.status === 'won') {
      wonCount++
      wonValue += num(d.value)
    } else if (d.status === 'lost') {
      lostCount++
      lostValue += num(d.value)
    }
  }
  const decided = wonCount + lostCount

  // ---- channels, usage, health ----
  const wa = whatsapp?.get(accountId) ?? null
  const ig = (instagramRes.error ? null : instagramRes.data) as {
    enabled?: boolean
    ig_user_id?: string | null
  } | null
  const u = usage?.get(accountId) ?? null
  const status = account?.status ?? access.status
  const live = status === 'active' || status === 'onboarding'
  const health = u && live ? computeHealth(u) : null
  const alerts = u
    ? computeAlerts(
        u,
        {
          status: access.status,
          since: account?.status_changed_at ?? account?.created_at ?? null,
        },
        now,
      ).map((a) => ({ kind: a.kind, label: a.label }))
    : []

  return {
    crm: {
      id: accountId,
      name: access.name,
      status: access.status,
      access: access.level,
      consent: access.consent,
      currency: account?.default_currency || 'BRL',
      health: health ? { score: health.score, band: health.band, trend: health.trend } : null,
    },
    window: { days, since, until: nowIso },
    leads: { total: leadRows.length, previous: leadsPrev, byOrigin, byDay },
    contacts: { total: contactsTotal, new: contactsNew },
    conversations: {
      open: convOpen,
      pending: convPending,
      waitingHuman: convWaiting,
      unassigned: convUnassigned,
      new: convNew,
    },
    messages: messageTotals,
    firstResponse,
    deals: {
      openCount: openDeals.length,
      openValue: openDeals.reduce((s, d) => s + num(d.value), 0),
      wonCount,
      wonValue,
      lostCount,
      lostValue,
      conversion: decided > 0 ? Math.round((wonCount / decided) * 100) / 100 : null,
    },
    tasks: { open: tasksOpen, overdue: tasksOverdue, dueToday: tasksToday },
    agenda: { today: eventsToday, next7Days: eventsNext },
    automations:
      automationsTotal === null ? null : { active: automationsActive ?? 0, total: automationsTotal },
    agents: agentsTotal === null ? null : { active: agentsActive ?? 0, total: agentsTotal },
    channels: {
      whatsapp: wa?.state ?? 'none',
      whatsappReason: wa?.reason ?? null,
      instagram: ig?.enabled && ig.ig_user_id ? 'connected' : ig ? 'attention' : 'none',
    },
    team: {
      members: membersCount,
      activeUsers7d: u?.activeUsers7d ?? null,
      lastActivityAt: u?.lastActivityAt ?? null,
    },
    alerts,
    // Setores (077/078): queues and deadlines, counts only. [] without setores.
    teams: (await loadTeamQueues(admin, accountId)).map((t) => ({
      name: t.name,
      members: t.members,
      queued: t.queued,
      waiting: t.waiting,
      overdue: t.overdue,
    })),
    lists:
      access.level === 'rows'
        ? await loadLists(admin, accountId, { origin: opts.origin, nowIso })
        : null,
    links: pageLinks(opts.origin, accountId),
    generatedAt: nowIso,
  }
}

// ------------------------------------------------------------
// The five short lists (only with Leitura / membership).
// ------------------------------------------------------------

/** Contact display names for ids, scoped to the CRM. */
export async function contactNames(
  admin: SupabaseClient,
  accountId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))))
  const out = new Map<string, string | null>()
  if (unique.length === 0) return out
  const { data } = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('account_id', accountId)
    .in('id', unique)
  for (const c of (data ?? []) as Array<{ id: string; name: string | null; phone: string | null }>) {
    out.set(c.id, c.name || c.phone || null)
  }
  return out
}

/** People's names (assignees), by user id. */
export async function peopleNames(
  admin: SupabaseClient,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))))
  const out = new Map<string, string | null>()
  if (unique.length === 0) return out
  const { data } = await admin.from('profiles').select('user_id, full_name, email').in('user_id', unique)
  for (const p of (data ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null }>) {
    out.set(p.user_id, p.full_name || p.email || null)
  }
  return out
}

async function loadLists(
  admin: SupabaseClient,
  accountId: string,
  opts: { origin: string; nowIso: string },
): Promise<SummaryLists> {
  const link = (t: Parameters<typeof crmLink>[2]) => crmLink(opts.origin, accountId, t)

  const [leadsRes, waitingRes, dealsRes, tasksRes, eventsRes] = await Promise.all([
    admin
      .from('leads')
      .select('id, full_name, source, campaign, raw, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(LIST_SIZE),
    admin
      .from('conversations')
      .select('id, contact_id, needs_human_since, assigned_agent_id')
      .eq('account_id', accountId)
      .neq('status', 'closed')
      .not('needs_human_since', 'is', null)
      .order('needs_human_since', { ascending: true })
      .limit(LIST_SIZE),
    admin
      .from('deals')
      .select('id, title, value, stage_id, pipeline_id, contact_id, updated_at')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(LIST_SIZE),
    admin
      .from('contact_tasks')
      .select('id, title, due_at, assigned_to, contact_id')
      .eq('account_id', accountId)
      .is('done_at', null)
      .lt('due_at', opts.nowIso)
      .order('due_at', { ascending: true })
      .limit(LIST_SIZE),
    admin
      .from('calendar_events')
      .select('id, title, starts_at, calendar_id, contact_id')
      .eq('account_id', accountId)
      .eq('kind', 'appointment')
      .not('status', 'in', '(cancelled,no_show,done)')
      .gte('starts_at', opts.nowIso)
      .order('starts_at', { ascending: true })
      .limit(LIST_SIZE),
  ])

  type LeadRow = { id: string; full_name: string | null; source: string | null; campaign: string | null; raw: unknown; created_at: string }
  type WaitRow = { id: string; contact_id: string | null; needs_human_since: string | null; assigned_agent_id: string | null }
  type DealRow = { id: string; title: string; value: unknown; stage_id: string | null; pipeline_id: string | null; contact_id: string | null; updated_at: string | null }
  type TaskRow = { id: string; title: string; due_at: string | null; assigned_to: string | null; contact_id: string | null }
  type EventRow = { id: string; title: string | null; starts_at: string; calendar_id: string | null; contact_id: string | null }

  const leads = (leadsRes.error ? [] : (leadsRes.data ?? [])) as LeadRow[]
  const waiting = (waitingRes.error ? [] : (waitingRes.data ?? [])) as WaitRow[]
  const deals = (dealsRes.error ? [] : (dealsRes.data ?? [])) as DealRow[]
  const tasks = (tasksRes.error ? [] : (tasksRes.data ?? [])) as TaskRow[]
  const events = (eventsRes.error ? [] : (eventsRes.data ?? [])) as EventRow[]

  const stageIds = Array.from(new Set(deals.map((d) => d.stage_id).filter((v): v is string => Boolean(v))))
  const pipelineIds = Array.from(new Set(deals.map((d) => d.pipeline_id).filter((v): v is string => Boolean(v))))
  const calendarIds = Array.from(new Set(events.map((e) => e.calendar_id).filter((v): v is string => Boolean(v))))

  const [names, people, stagesRes, pipelinesRes, calendarsRes] = await Promise.all([
    contactNames(admin, accountId, [
      ...waiting.map((w) => w.contact_id),
      ...deals.map((d) => d.contact_id),
      ...tasks.map((t) => t.contact_id),
      ...events.map((e) => e.contact_id),
    ]),
    peopleNames(admin, tasks.map((t) => t.assigned_to)),
    stageIds.length
      ? admin.from('pipeline_stages').select('id, name').in('id', stageIds)
      : Promise.resolve({ data: [], error: null }),
    pipelineIds.length
      ? admin.from('pipelines').select('id, name').eq('account_id', accountId).in('id', pipelineIds)
      : Promise.resolve({ data: [], error: null }),
    calendarIds.length
      ? admin.from('calendars').select('id, name').eq('account_id', accountId).in('id', calendarIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const byId = (rows: unknown) =>
    new Map(((rows ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]))
  const stageName = byId(stagesRes.data)
  const pipelineName = byId(pipelinesRes.data)
  const calendarName = byId(calendarsRes.data)

  return {
    recentLeads: leads.map((l) => {
      const n = normalizeLead(l.raw ?? {})
      return {
        id: l.id,
        name: l.full_name ?? n.fullName,
        origin: n.origin ?? l.source,
        campaign: l.campaign ?? n.campaign,
        route: n.route,
        createdAt: l.created_at,
        link: link({ kind: 'lead', id: l.id }),
      }
    }),
    waitingConversations: waiting.map((w) => ({
      id: w.id,
      contactName: w.contact_id ? (names.get(w.contact_id) ?? null) : null,
      waitingSince: w.needs_human_since,
      assigned: Boolean(w.assigned_agent_id),
      link: link({ kind: 'conversation', id: w.id }),
    })),
    hotDeals: deals.map((d) => ({
      id: d.id,
      title: d.title,
      value: num(d.value),
      stage: d.stage_id ? (stageName.get(d.stage_id) ?? null) : null,
      pipeline: d.pipeline_id ? (pipelineName.get(d.pipeline_id) ?? null) : null,
      contactName: d.contact_id ? (names.get(d.contact_id) ?? null) : null,
      updatedAt: d.updated_at,
      link: link({ kind: 'deal', id: d.id, pipelineId: d.pipeline_id }),
    })),
    overdueTasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      assignee: t.assigned_to ? (people.get(t.assigned_to) ?? null) : null,
      contactName: t.contact_id ? (names.get(t.contact_id) ?? null) : null,
      link: t.contact_id
        ? link({ kind: 'contact', id: t.contact_id })
        : link({ kind: 'page', path: '/contacts' }),
    })),
    upcomingEvents: events.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      calendar: e.calendar_id ? (calendarName.get(e.calendar_id) ?? null) : null,
      contactName: e.contact_id ? (names.get(e.contact_id) ?? null) : null,
      link: link({ kind: 'event', id: e.id, startsAt: e.starts_at }),
    })),
  }
}
