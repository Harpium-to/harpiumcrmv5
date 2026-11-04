// ============================================================
// CRM lifecycle reads for the agency console (migration 050).
//
// Service-role only, like the rest of src/lib/agencia: call these
// after requireAgencia(). Every read degrades to "today's behaviour"
// when 049/050 aren't applied yet (missing column / table), so the
// console keeps working on an older database.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/auth/account-context'
import {
  isAgencyAccessLevel,
  toCrmStatus,
  type AgencyAccessLevel,
  type CrmStatus,
} from './crm'
import { isAgenciaRole, type AgenciaRole } from './roles'

/** Postgres / PostgREST "column does not exist". */
export function isMissingColumn(err: { code?: string } | null): boolean {
  return !!err && (err.code === '42703' || err.code === 'PGRST204')
}

export interface AccountRow {
  id: string
  name: string
  owner_user_id: string
  created_at: string
  status: CrmStatus
  niche: string | null
  manager_user_id: string | null
  notes: string | null
}

/** accounts with the 050 fields, or their pre-050 defaults. */
export async function loadAccountRows(
  admin: SupabaseClient,
  accountId?: string,
): Promise<AccountRow[]> {
  let q = admin
    .from('accounts')
    .select('id, name, owner_user_id, created_at, status, niche, manager_user_id, notes')
    .order('created_at', { ascending: true })
  if (accountId) q = q.eq('id', accountId)
  const { data, error } = await q
  if (!error) {
    return (data ?? []).map((a) => ({ ...a, status: toCrmStatus(a.status) }))
  }
  if (!isMissingColumn(error)) throw error

  let legacy = admin
    .from('accounts')
    .select('id, name, owner_user_id, created_at')
    .order('created_at', { ascending: true })
  if (accountId) legacy = legacy.eq('id', accountId)
  const { data: rows, error: legacyErr } = await legacy
  if (legacyErr) throw legacyErr
  return (rows ?? []).map((a) => ({
    ...a,
    status: 'active' as const,
    niche: null,
    manager_user_id: null,
    notes: null,
  }))
}

export interface PendingOwnerInvite {
  accountId: string
  email: string
  expiresAt: string
}

/** Open owner invitations, newest per CRM. Empty before 050. */
export async function loadPendingOwnerInvites(
  admin: SupabaseClient,
  accountId?: string,
): Promise<Map<string, PendingOwnerInvite>> {
  let q = admin
    .from('account_invitations')
    .select('account_id, email, expires_at, created_at')
    .eq('role', 'owner')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (accountId) q = q.eq('account_id', accountId)
  const { data, error } = await q
  const out = new Map<string, PendingOwnerInvite>()
  if (error) {
    if (isMissingColumn(error)) return out
    throw error
  }
  for (const r of data ?? []) {
    if (!r.email || out.has(r.account_id)) continue
    out.set(r.account_id, {
      accountId: r.account_id,
      email: r.email,
      expiresAt: r.expires_at,
    })
  }
  return out
}

export interface AgencyOperator {
  userId: string
  name: string
  role: AgenciaRole
}

/** Agency members who can be a CRM's responsible manager. */
export async function listAgencyOperators(
  admin: SupabaseClient,
): Promise<AgencyOperator[]> {
  const { data, error } = await admin
    .from('agencia_membros')
    .select('user_id, label, role')
  if (error) {
    if (isMissingColumn(error)) return []
    throw error
  }
  const members = (data ?? []).filter(
    (m) => m.role === 'super_admin' || m.role === 'manager',
  )
  if (members.length === 0) return []

  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('user_id, full_name, email')
    .in(
      'user_id',
      members.map((m) => m.user_id),
    )
  if (profErr) throw profErr
  const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]))

  return members
    .map((m) => {
      const p = byId.get(m.user_id)
      return {
        userId: m.user_id,
        name: m.label || p?.full_name || p?.email || m.user_id,
        role: isAgenciaRole(m.role) ? m.role : 'support',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export interface PendingSignup {
  userId: string
  name: string | null
  email: string | null
  createdAt: string
  /** An open invitation already addressed to this email, if any. */
  invitedTo: string | null
}

/**
 * People who signed up and have no CRM — what the console shows as
 * "aguardando liberação". Agency members are left out (they live in
 * the console). Empty before 049, when every profile had an account.
 */
export async function listPendingSignups(
  admin: SupabaseClient,
): Promise<PendingSignup[]> {
  const [profilesRes, agencyRes] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id, full_name, email, created_at')
      .is('account_id', null)
      .order('created_at', { ascending: false }),
    admin.from('agencia_membros').select('user_id'),
  ])
  if (profilesRes.error) throw profilesRes.error
  if (agencyRes.error && !isMissingTable(agencyRes.error)) throw agencyRes.error

  const agency = new Set((agencyRes.data ?? []).map((m) => m.user_id))
  const people = (profilesRes.data ?? []).filter((p) => !agency.has(p.user_id))
  if (people.length === 0) return []

  const emails = people
    .map((p) => p.email?.toLowerCase())
    .filter((e): e is string => !!e)
  const invitedTo = new Map<string, string>()
  if (emails.length > 0) {
    // Two point queries rather than an embed: a stale PostgREST schema
    // cache breaks embeds (HANDOFF §4, issue #294).
    const { data: invites, error } = await admin
      .from('account_invitations')
      .select('email, account_id')
      .in('email', emails)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
    if (error && !isMissingColumn(error)) throw error
    const accountIds = [...new Set((invites ?? []).map((i) => i.account_id))]
    if (accountIds.length > 0) {
      const { data: accs, error: accErr } = await admin
        .from('accounts')
        .select('id, name')
        .in('id', accountIds)
      if (accErr) throw accErr
      const nameById = new Map((accs ?? []).map((a) => [a.id, a.name]))
      for (const i of invites ?? []) {
        const name = nameById.get(i.account_id)
        if (i.email && name) invitedTo.set(i.email.toLowerCase(), name)
      }
    }
  }

  return people.map((p) => ({
    userId: p.user_id,
    name: p.full_name || null,
    email: p.email ?? null,
    createdAt: p.created_at,
    invitedTo: p.email ? invitedTo.get(p.email.toLowerCase()) ?? null : null,
  }))
}

export interface PlatformSettings {
  /** null = migration 049 not applied (no setting to change yet). */
  autoPersonalAccount: boolean | null
}

export async function getPlatformSettings(
  admin: SupabaseClient,
): Promise<PlatformSettings> {
  const { data, error } = await admin
    .from('platform_settings')
    .select('auto_personal_account')
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return { autoPersonalAccount: null }
    throw error
  }
  return { autoPersonalAccount: data?.auto_personal_account ?? true }
}

/** The CRM's current consent level ('metrics' when there is no row). */
export async function getAgencyAccessLevel(
  admin: SupabaseClient,
  accountId: string,
): Promise<AgencyAccessLevel | null> {
  const { data, error } = await admin.rpc('agency_access_level', {
    p_account_id: accountId,
  })
  if (error) return null
  return isAgencyAccessLevel(data) ? data : null
}
