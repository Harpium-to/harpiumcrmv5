// ============================================================
// GET /api/plataforma/v1/crms — the CRMs a person can see.
//
// Agency team → every CRM, as the platform panel shows it (/agencia):
// status, consent, health, usage, alerts. All aggregates, so visible
// whatever consent each CRM granted (plano-plataforma-agencia.md §6.5).
// Anyone else → only the CRMs they are a member of.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { loadConsentLevels, loadPlatformUsage } from '@/lib/agencia/crms'
import { listAccountsOverview } from '@/lib/agencia/queries'
import { buildPanelRows, type PanelRow } from '@/lib/agencia/panel'
import { loadWhatsAppStatuses } from '@/lib/agencia/whatsapp'
import { toCrmStatus } from '@/lib/agencia/crm'

import type { PlatformPerson } from './auth'
import { pageLinks } from './links'

export interface CarteiraRow {
  id: string
  name: string
  niche: string | null
  status: string
  /** How the person reaches it: their member role, or 'agency'. */
  via: 'member' | 'agency'
  memberRole: string | null
  access: string | null
  ownerLabel: string | null
  manager: { email: string | null } | null
  memberCount: number | null
  contactCount: number | null
  health: { score: number; band: string; trend: string } | null
  usage: {
    activeUsers7d: number
    membersTotal: number
    lastActivityAt: string | null
    messages7d: number
    messagesPrev7d: number
    openConversations: number
    openUnassigned: number
    unanswered24h: number
    won30d: number
    wonValue30d: number
  } | null
  channels: { whatsapp: string; whatsappReason: string | null } | null
  alerts: { kind: string; label: string }[]
  links: { abrir: string; painel: string | null }
}

function fromPanelRow(
  r: PanelRow,
  origin: string,
  memberRole: string | null,
  wa: { state: string; reason: string | null } | null,
): CarteiraRow {
  const links = pageLinks(origin, r.id)
  return {
    id: r.id,
    name: r.name,
    niche: r.niche,
    status: r.status,
    via: memberRole ? 'member' : 'agency',
    memberRole,
    access: r.access,
    ownerLabel: r.ownerLabel,
    manager: r.managerEmail ? { email: r.managerEmail } : null,
    memberCount: r.memberCount,
    contactCount: r.contactCount,
    health: r.health ? { score: r.health.score, band: r.health.band, trend: r.health.trend } : null,
    usage: r.usage
      ? {
          activeUsers7d: r.usage.activeUsers7d,
          membersTotal: r.usage.membersTotal,
          lastActivityAt: r.usage.lastActivityAt,
          messages7d: r.usage.msgsByWeek[0] ?? 0,
          messagesPrev7d: r.usage.msgsByWeek[1] ?? 0,
          openConversations: r.usage.openConversations,
          openUnassigned: r.usage.openUnassigned,
          unanswered24h: r.usage.unanswered24h,
          won30d: r.usage.won30d,
          wonValue30d: r.usage.wonValue30d,
        }
      : null,
    channels: wa ? { whatsapp: wa.state, whatsappReason: wa.reason } : { whatsapp: 'none', whatsappReason: null },
    alerts: r.alerts.map((a) => ({ kind: a.kind, label: a.label })),
    links: { abrir: links.abrir, painel: links.painelAgencia },
  }
}

export async function loadCarteira(
  admin: SupabaseClient,
  person: PlatformPerson,
  opts: { origin: string; includeArchived?: boolean; now?: Date },
): Promise<CarteiraRow[]> {
  const memberRes = await admin
    .from('account_members')
    .select('account_id, role')
    .eq('user_id', person.userId)
  const memberRole = new Map<string, string>()
  for (const m of (memberRes.error ? [] : (memberRes.data ?? [])) as Array<{
    account_id: string
    role: string
  }>) {
    memberRole.set(m.account_id, m.role)
  }

  if (person.agencyRole) {
    const [accounts, usage, access, whatsapp] = await Promise.all([
      listAccountsOverview(admin),
      loadPlatformUsage(admin),
      loadConsentLevels(admin),
      loadWhatsAppStatuses(admin).catch(() => null),
    ])
    return buildPanelRows(accounts, usage, access, opts.now ?? new Date())
      .filter((r) => opts.includeArchived || r.status !== 'archived')
      .map((r) => fromPanelRow(r, opts.origin, memberRole.get(r.id) ?? null, whatsapp?.get(r.id) ?? null))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  const ids = [...memberRole.keys()]
  if (ids.length === 0) return []
  const { data } = await admin.from('accounts').select('id, name, niche, status').in('id', ids)
  return ((data ?? []) as Array<{ id: string; name: string; niche?: string | null; status?: unknown }>)
    .map((a) => {
      const links = pageLinks(opts.origin, a.id)
      const row: CarteiraRow = {
        id: a.id,
        name: a.name,
        niche: a.niche ?? null,
        status: toCrmStatus(a.status),
        via: 'member',
        memberRole: memberRole.get(a.id) ?? null,
        access: null,
        ownerLabel: null,
        manager: null,
        memberCount: null,
        contactCount: null,
        health: null,
        usage: null,
        channels: null,
        alerts: [],
        links: { abrir: links.abrir, painel: null },
      }
      return row
    })
    .filter((r) => opts.includeArchived || r.status !== 'archived')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
