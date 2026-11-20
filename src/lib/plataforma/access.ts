// ============================================================
// What one person may see of one CRM through the platform API.
//
// The CRM's own rule, applied to the person the Agency OS speaks for:
// platform_effective_role(user, account) (migration 075) is a copy of
// effective_role_in (049/050) for an arbitrary user.
//
//   a role (member, or agency with Leitura/Total)  → 'rows'
//   no role, but agency team                        → 'metrics'
//   neither                                         → 403 no_access
//
// 'metrics' means aggregates only: no name, phone, e-mail or message
// text may leave the server.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { getAgencyAccessLevel } from '@/lib/agencia/crms';
import { toCrmStatus, type AgencyAccessLevel, type CrmStatus } from '@/lib/agencia/crm';

import type { PlatformPerson } from './auth';
import { platformErrors } from './errors';

export type CrmAccessLevel = 'rows' | 'metrics';

export interface CrmAccess {
  accountId: string;
  name: string;
  status: CrmStatus;
  level: CrmAccessLevel;
  /** How the person reaches this CRM. Agency reads are audited. */
  via: 'member' | 'agency';
  /** Effective role in the CRM (owner/admin/agent/viewer), or null. */
  role: string | null;
  /** The owner's consent to the agency (null when not asked / unknown). */
  consent: AgencyAccessLevel | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export async function resolveCrmAccess(
  admin: SupabaseClient,
  person: PlatformPerson,
  accountId: string,
): Promise<CrmAccess> {
  if (!isUuid(accountId)) throw platformErrors.notFound('CRM não encontrado');

  const [accountRes, roleRes, memberRes] = await Promise.all([
    admin.from('accounts').select('id, name, status').eq('id', accountId).maybeSingle(),
    admin.rpc('platform_effective_role', { p_user_id: person.userId, p_account_id: accountId }),
    admin
      .from('account_members')
      .select('role')
      .eq('account_id', accountId)
      .eq('user_id', person.userId)
      .maybeSingle(),
  ]);

  const account = accountRes.data as { id: string; name: string; status?: unknown } | null;
  if (accountRes.error || !account) throw platformErrors.notFound('CRM não encontrado');

  if (roleRes.error) {
    console.error('[plataforma/access] role lookup failed:', roleRes.error.message);
  }
  const role = !roleRes.error && typeof roleRes.data === 'string' ? roleRes.data : null;
  const isMember = !memberRes.error && Boolean(memberRes.data);

  let level: CrmAccessLevel;
  if (role) level = 'rows';
  else if (person.agencyRole) level = 'metrics';
  else throw platformErrors.noAccess();

  const via = isMember ? 'member' : 'agency';
  const consent = via === 'agency' ? await getAgencyAccessLevel(admin, accountId) : null;

  return {
    accountId,
    name: account.name,
    status: toCrmStatus(account.status),
    level,
    via,
    role,
    consent,
  };
}

/** Lists with personal data need 'rows'. */
export function requireRows(access: CrmAccess): void {
  if (access.level !== 'rows') throw platformErrors.metricsOnly();
}
