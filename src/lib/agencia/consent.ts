// ============================================================
// What the agency console may show of a client CRM (Fase 3).
//
// The console reads through the service role, which bypasses RLS, so
// the CRM owner's consent has to be checked here, on the server,
// before any row with personal data is read or rendered:
//
//   metrics  aggregates only — counts, volumes, statuses. No names,
//            phones, emails or message text.
//   read     everything, read-only (the console never writes client data)
//   full     same as read in the console; "full" matters when the agency
//            operates inside the CRM (set_active_account, Fase 6)
//
// Before migration 049 there is no consent at all and the console
// behaves as it always did (null = not enforced). Any other failure to
// read the level fails closed, to 'metrics'.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingFunction } from '@/lib/auth/account-context'
import { isAgencyAccessLevel, type AgencyAccessLevel } from './crm'
import type { AgenciaRole } from './roles'

/** null = consent model not installed yet (pre-049). */
export type ConsentLevel = AgencyAccessLevel | null

export function consentAllowsRows(level: ConsentLevel): boolean {
  return level === null || level === 'read' || level === 'full'
}

export async function loadConsent(
  admin: SupabaseClient,
  accountId: string,
): Promise<ConsentLevel> {
  const { data, error } = await admin.rpc('agency_access_level', {
    p_account_id: accountId,
  })
  if (error) {
    if (isMissingFunction(error)) return null
    console.error('[loadConsent] agency_access_level error:', error)
    return 'metrics'
  }
  return isAgencyAccessLevel(data) ? data : 'metrics'
}

export interface PendingAccessRequest {
  id: string
  level: 'read' | 'full'
  tempHours: number | null
  reason: string | null
  createdAt: string
}

/** The open request for a CRM, if any. null before 051. */
export async function loadPendingRequest(
  client: SupabaseClient,
  accountId?: string,
): Promise<PendingAccessRequest | null> {
  let q = client
    .from('account_agency_access_requests')
    .select('id, requested_level, temp_hours, reason, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
  if (accountId) q = q.eq('account_id', accountId)
  const { data, error } = await q
  if (error || !data || data.length === 0) return null
  const r = data[0]
  return {
    id: r.id,
    level: r.requested_level === 'full' ? 'full' : 'read',
    tempHours: r.temp_hours ?? null,
    reason: r.reason ?? null,
    createdAt: r.created_at,
  }
}

/** "Total por 24 horas" / "Leitura" — for the request, in words. */
export function describeRequest(level: 'read' | 'full', tempHours: number | null): string {
  const name = level === 'full' ? 'Total' : 'Leitura'
  if (tempHours === null) return name
  if (tempHours % 24 === 0) {
    const days = tempHours / 24
    return `${name} por ${days} dia${days === 1 ? '' : 's'}`
  }
  return `${name} por ${tempHours} hora${tempHours === 1 ? '' : 's'}`
}

export interface ConsentGate {
  level: ConsentLevel
  /** Personal data may be read and shown. */
  allowed: boolean
  pending: PendingAccessRequest | null
  /** This operator may ask the owner (super_admin, or the CRM's manager). */
  canRequest: boolean
  /** There is an owner to answer (an agency-created CRM may not have one yet). */
  hasOwner: boolean
}

/**
 * Everything a console page needs to decide between showing a client's
 * data and showing the consent wall with a way to ask.
 */
export async function loadConsentGate(
  admin: SupabaseClient,
  accountId: string,
  operator: { userId: string; role: AgenciaRole },
): Promise<ConsentGate> {
  const [level, pending, accountRes, ownerRes] = await Promise.all([
    loadConsent(admin, accountId),
    loadPendingRequest(admin, accountId),
    admin.from('accounts').select('manager_user_id').eq('id', accountId).maybeSingle(),
    admin
      .from('account_members')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('role', 'owner')
      .limit(1),
  ])
  const managerId = (accountRes.data as { manager_user_id?: string | null } | null)
    ?.manager_user_id
  const canRequest =
    operator.role === 'super_admin' ||
    (operator.role === 'manager' && managerId === operator.userId)

  return {
    level,
    allowed: consentAllowsRows(level),
    pending,
    canRequest,
    hasOwner: (ownerRes.data ?? []).length > 0,
  }
}
