// ============================================================
// Platform panel view model — pure, unit-testable, no I/O.
//
// Joins what the console loads (accounts overview, usage from 052,
// consent levels from 049) into one row per CRM, then filters and
// sorts by the panel's query string. Everything here is aggregates:
// it may be shown whatever consent level a CRM granted.
// ============================================================

import { isCrmStatus, type AgencyAccessLevel, type CrmStatus } from './crm'
import {
  computeAlerts,
  computeHealth,
  type CrmAlert,
  type CrmUsage,
  type Health,
} from './health'
import type { AccountOverview } from './queries'

export interface PanelRow {
  id: string
  name: string
  niche: string | null
  status: CrmStatus
  ownerLabel: string
  managerUserId: string | null
  managerEmail: string | null
  access: AgencyAccessLevel | null
  memberCount: number
  contactCount: number
  /** null before migration 052 — the panel shows dashes. */
  usage: CrmUsage | null
  health: Health | null
  alerts: CrmAlert[]
}

export function buildPanelRows(
  accounts: AccountOverview[],
  usage: Map<string, CrmUsage> | null,
  access: Map<string, AgencyAccessLevel>,
  now: Date = new Date(),
): PanelRow[] {
  return accounts.map((a) => {
    const u = usage?.get(a.id) ?? null
    const live = a.status === 'active' || a.status === 'onboarding'
    return {
      id: a.id,
      name: a.name,
      niche: a.niche,
      status: a.status,
      ownerLabel:
        a.ownerEmail ??
        (a.pendingOwnerEmail ? `convite pendente: ${a.pendingOwnerEmail}` : 'sem dono'),
      managerUserId: a.managerUserId,
      managerEmail: a.managerEmail,
      access: access.get(a.id) ?? null,
      memberCount: a.memberCount,
      contactCount: a.contactCount,
      usage: u,
      // A suspended or archived CRM isn't "unhealthy"; it's off.
      health: u && live ? computeHealth(u) : null,
      alerts: u
        ? computeAlerts(u, { status: a.status, since: a.statusChangedAt ?? a.createdAt }, now)
        : [],
    }
  })
}

export type PanelSort = 'saude' | 'uso' | 'acesso' | 'nome'

export interface PanelFilters {
  /** null = everything but archived. */
  status: CrmStatus | null
  niche: string | null
  manager: string | null
  /** Only CRMs in the "at risk" band. */
  risk: boolean
  /** Only CRMs nobody opened in 7+ days. */
  idle: boolean
  sort: PanelSort
}

const SORTS: readonly PanelSort[] = ['saude', 'uso', 'acesso', 'nome']

export function parsePanelFilters(
  sp: Record<string, string | undefined>,
): PanelFilters {
  return {
    status: isCrmStatus(sp.status) ? sp.status : null,
    niche: sp.nicho || null,
    manager: sp.gestor || null,
    risk: sp.risco === '1',
    idle: sp.semacesso === '1',
    sort: (SORTS as readonly string[]).includes(sp.ordem ?? '')
      ? (sp.ordem as PanelSort)
      : 'saude',
  }
}

/** Query string for the panel with some filters changed. */
export function panelHref(
  f: PanelFilters,
  change: Partial<PanelFilters>,
  dias: number,
): string {
  const next = { ...f, ...change }
  const sp = new URLSearchParams({ dias: String(dias) })
  if (next.status) sp.set('status', next.status)
  if (next.niche) sp.set('nicho', next.niche)
  if (next.manager) sp.set('gestor', next.manager)
  if (next.risk) sp.set('risco', '1')
  if (next.idle) sp.set('semacesso', '1')
  if (next.sort !== 'saude') sp.set('ordem', next.sort)
  return `/agencia?${sp.toString()}`
}

const lastSeen = (r: PanelRow) =>
  r.usage?.lastActivityAt ? new Date(r.usage.lastActivityAt).getTime() : 0

/** Messages this week plus weight for people — "how much it is used". */
export function usageVolume(r: PanelRow): number {
  if (!r.usage) return 0
  return r.usage.msgsByWeek[0] + 20 * r.usage.activeUsers7d
}

export function applyPanelFilters(rows: PanelRow[], f: PanelFilters): PanelRow[] {
  const out = rows.filter((r) => {
    if (f.status ? r.status !== f.status : r.status === 'archived') return false
    if (f.niche && r.niche !== f.niche) return false
    if (f.manager && r.managerUserId !== f.manager) return false
    if (f.risk && r.health?.band !== 'risk') return false
    if (f.idle && !r.alerts.some((a) => a.kind === 'no_access')) return false
    return true
  })

  const byName = (a: PanelRow, b: PanelRow) => a.name.localeCompare(b.name, 'pt-BR')
  switch (f.sort) {
    case 'nome':
      return out.sort(byName)
    case 'uso':
      return out.sort((a, b) => usageVolume(b) - usageVolume(a) || byName(a, b))
    case 'acesso':
      // Longest without access first: that's who to call.
      return out.sort((a, b) => lastSeen(a) - lastSeen(b) || byName(a, b))
    case 'saude':
    default:
      // Worst health first; CRMs without a score (suspended, no data) last.
      return out.sort(
        (a, b) =>
          (a.health?.score ?? 101) - (b.health?.score ?? 101) || byName(a, b),
      )
  }
}

export interface PanelTotals {
  active: number
  onboarding: number
  suspended: number
  risk: number
  idle: number
  activeUsers7d: number
  messages7d: number
  wonValue30d: number
}

export function panelTotals(rows: PanelRow[]): PanelTotals {
  const t: PanelTotals = {
    active: 0,
    onboarding: 0,
    suspended: 0,
    risk: 0,
    idle: 0,
    activeUsers7d: 0,
    messages7d: 0,
    wonValue30d: 0,
  }
  for (const r of rows) {
    if (r.status === 'archived') continue
    if (r.status === 'active') t.active++
    if (r.status === 'onboarding') t.onboarding++
    if (r.status === 'suspended') t.suspended++
    if (r.status === 'active' && r.health?.band === 'risk') t.risk++
    if (r.alerts.some((a) => a.kind === 'no_access')) t.idle++
    if (r.usage) {
      t.activeUsers7d += r.usage.activeUsers7d
      t.messages7d += r.usage.msgsByWeek[0]
      t.wonValue30d += r.usage.wonValue30d
    }
  }
  return t
}

/** Who uses it most and least — active CRMs only, `n` each. */
export function usageExtremes(
  rows: PanelRow[],
  n = 5,
): { most: PanelRow[]; least: PanelRow[] } {
  const active = rows.filter((r) => r.status === 'active' && r.usage)
  const sorted = [...active].sort((a, b) => usageVolume(b) - usageVolume(a))
  const most = sorted.slice(0, n)
  const least = sorted
    .slice()
    .reverse()
    .filter((r) => !most.includes(r) || sorted.length <= n)
    .slice(0, n)
  return { most, least }
}
