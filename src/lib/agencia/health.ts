// ============================================================
// CRM health score and alerts — pure, unit-testable, no I/O.
//
// Input is one row of agencia_platform_usage() (migration 052):
// aggregates only. Weights follow docs/plano-plataforma-agencia.md §6.3;
// change them here, the tests say what each one is for.
//
//   30  people using it   active members this week / members
//   25  momentum          messages this week vs. the 4 weeks before
//   15  a channel         WhatsApp / Instagram / gateway connected
//   15  responsiveness    open conversations not left waiting 24h+
//   15  depth             modules in use (funnel, automations or
//                         flows, AI agents, broadcasts) — 3 of 4 is full
//
//   70+ healthy · 40–69 attention · < 40 at risk
//
// The trend compares with the same score a week earlier, from the
// numbers we have for then (last week's active users and messages);
// channel, queue and modules are taken as unchanged.
// ============================================================

import type { CrmStatus } from './crm'

export interface CrmUsage {
  accountId: string
  membersTotal: number
  activeUsers7d: number
  activeUsersPrev7d: number
  lastActivityAt: string | null
  /** Messages per week, most recent first: [last 7 days, the 7 before, …] (6 weeks). */
  msgsByWeek: number[]
  msgsIn7d: number
  msgsOut7d: number
  openConversations: number
  openUnassigned: number
  unanswered24h: number
  channelConnected: boolean
  automationsActive: number
  flowsActive: number
  agentsActive: number
  broadcasts30d: number
  dealsMoved30d: number
  won30d: number
  wonValue30d: number
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** One agencia_platform_usage() row. NUMERIC arrives as a string (HANDOFF §4). */
export function parseUsageRow(r: Record<string, unknown>): CrmUsage {
  return {
    accountId: String(r.account_id),
    membersTotal: n(r.members_total),
    activeUsers7d: n(r.active_users_7d),
    activeUsersPrev7d: n(r.active_users_prev_7d),
    lastActivityAt: typeof r.last_activity_at === 'string' ? r.last_activity_at : null,
    msgsByWeek: [r.msgs_w0, r.msgs_w1, r.msgs_w2, r.msgs_w3, r.msgs_w4, r.msgs_w5].map(n),
    msgsIn7d: n(r.msgs_in_7d),
    msgsOut7d: n(r.msgs_out_7d),
    openConversations: n(r.open_conversations),
    openUnassigned: n(r.open_unassigned),
    unanswered24h: n(r.unanswered_24h),
    channelConnected: r.channel_connected === true,
    automationsActive: n(r.automations_active),
    flowsActive: n(r.flows_active),
    agentsActive: n(r.agents_active),
    broadcasts30d: n(r.broadcasts_30d),
    dealsMoved30d: n(r.deals_moved_30d),
    won30d: n(r.won_30d),
    wonValue30d: n(r.won_value_30d),
  }
}

export type HealthBand = 'healthy' | 'attention' | 'risk'

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  healthy: 'Saudável',
  attention: 'Atenção',
  risk: 'Em risco',
}

export interface HealthParts {
  users: number
  momentum: number
  channel: number
  responsiveness: number
  modules: number
}

export interface Health {
  score: number
  band: HealthBand
  parts: HealthParts
  prevScore: number
  trend: 'up' | 'down' | 'flat'
}

/** 0..1: this week's messages against the average of the four before. */
export function momentum(current: number, before: number[]): number {
  const base = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0
  if (base === 0) return current > 0 ? 1 : 0
  return Math.min(current / base, 1)
}

export function modulesInUse(u: CrmUsage): number {
  return [
    u.dealsMoved30d > 0,
    u.automationsActive + u.flowsActive > 0,
    u.agentsActive > 0,
    u.broadcasts30d > 0,
  ].filter(Boolean).length
}

function scoreParts(u: CrmUsage, activeUsers: number, mom: number): HealthParts {
  const resp =
    u.openConversations === 0
      ? 1
      : 1 - Math.min(u.unanswered24h / u.openConversations, 1)
  return {
    users: 30 * Math.min(activeUsers / Math.max(u.membersTotal, 1), 1),
    momentum: 25 * mom,
    channel: u.channelConnected ? 15 : 0,
    responsiveness: 15 * resp,
    modules: 15 * Math.min(modulesInUse(u) / 3, 1),
  }
}

const total = (p: HealthParts) =>
  Math.round(p.users + p.momentum + p.channel + p.responsiveness + p.modules)

export function bandOf(score: number): HealthBand {
  if (score >= 70) return 'healthy'
  if (score >= 40) return 'attention'
  return 'risk'
}

export function computeHealth(u: CrmUsage): Health {
  const w = u.msgsByWeek
  const parts = scoreParts(u, u.activeUsers7d, momentum(w[0] ?? 0, w.slice(1, 5)))
  const prevParts = scoreParts(u, u.activeUsersPrev7d, momentum(w[1] ?? 0, w.slice(2, 6)))
  const score = total(parts)
  const prevScore = total(prevParts)
  const diff = score - prevScore
  return {
    score,
    band: bandOf(score),
    parts,
    prevScore,
    trend: diff >= 5 ? 'up' : diff <= -5 ? 'down' : 'flat',
  }
}

/** Week-over-week change in messages, or null when last week had none. */
export function messageDelta(u: CrmUsage): number | null {
  const [w0 = 0, w1 = 0] = u.msgsByWeek
  if (w1 === 0) return null
  return (w0 - w1) / w1
}

export type AlertKind =
  | 'no_channel'
  | 'unanswered'
  | 'no_access'
  | 'message_drop'
  | 'onboarding_stalled'
  | 'backlog'

export interface CrmAlert {
  kind: AlertKind
  label: string
  /** Lower is more urgent. */
  priority: number
}

const DAY = 24 * 60 * 60 * 1000
export const NO_ACCESS_DAYS = 7
export const ONBOARDING_STALL_DAYS = 14
export const BACKLOG_THRESHOLD = 5
/** Below this, a weekly drop is noise, not a signal. */
export const DROP_MIN_MESSAGES = 20

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

/**
 * What needs the agency's attention in one CRM. Suspended and archived
 * CRMs raise nothing; a CRM in onboarding only raises "stalled" — no
 * channel and no use are expected while it is being set up.
 */
export function computeAlerts(
  u: CrmUsage,
  lifecycle: { status: CrmStatus; since: string | null },
  now: Date = new Date(),
): CrmAlert[] {
  if (lifecycle.status === 'suspended' || lifecycle.status === 'archived') return []

  if (lifecycle.status === 'onboarding') {
    const since = lifecycle.since ? new Date(lifecycle.since).getTime() : null
    if (since !== null && now.getTime() - since > ONBOARDING_STALL_DAYS * DAY) {
      const days = Math.floor((now.getTime() - since) / DAY)
      return [
        { kind: 'onboarding_stalled', label: `Em implantação há ${days} dias`, priority: 2 },
      ]
    }
    return []
  }

  const alerts: CrmAlert[] = []
  if (!u.channelConnected) {
    alerts.push({ kind: 'no_channel', label: 'Nenhum canal conectado', priority: 0 })
  }
  if (u.unanswered24h > 0) {
    alerts.push({
      kind: 'unanswered',
      label: `${plural(u.unanswered24h, 'conversa', 'conversas')} sem resposta há 24h+`,
      priority: 1,
    })
  }
  const last = u.lastActivityAt ? new Date(u.lastActivityAt).getTime() : null
  if (last === null) {
    alerts.push({ kind: 'no_access', label: 'Ninguém entrou ainda', priority: 2 })
  } else if (now.getTime() - last > NO_ACCESS_DAYS * DAY) {
    const days = Math.floor((now.getTime() - last) / DAY)
    alerts.push({ kind: 'no_access', label: `Ninguém entra há ${days} dias`, priority: 2 })
  }
  const [w0 = 0, w1 = 0] = u.msgsByWeek
  if (w1 >= DROP_MIN_MESSAGES && w0 < w1 / 2) {
    const pct = Math.round(((w1 - w0) / w1) * 100)
    alerts.push({
      kind: 'message_drop',
      label: `Mensagens caíram ${pct}% na semana`,
      priority: 3,
    })
  }
  if (u.openUnassigned >= BACKLOG_THRESHOLD) {
    alerts.push({
      kind: 'backlog',
      label: `${plural(u.openUnassigned, 'conversa', 'conversas')} sem atendente`,
      priority: 4,
    })
  }
  return alerts.sort((a, b) => a.priority - b.priority)
}
