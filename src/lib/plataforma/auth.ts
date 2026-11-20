// ============================================================
// /api/plataforma/v1 authentication — a platform key plus the person
// the request speaks for.
//
//   Authorization: Bearer hpk_live_…        the agency's key
//   X-Harpium-Pessoa: pessoa@exemplo.com     who is looking
//
// The key proves the call comes from the agency's internal system;
// the person decides WHAT may be seen: the Agency OS verified their
// Google login and sends that e-mail, and here the CRM applies its own
// rules to that person (resolveCrmAccess). Without a login in the CRM
// there is nothing to show — consent and the audit log are per person.
//
// Order of checks (each with its own answer, see errors.ts):
//   key (401) → rate limit (429) → scope (403 missing_scope)
//   → person header (400) → login in the CRM (403 no_crm_login)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/agencia/admin-client';
import { isAgenciaRole, type AgenciaRole } from '@/lib/agencia/roles';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

import { platformErrors } from './errors';
import { hashPlatformKey, looksLikePlatformKey } from './keys';
import { hasPlatformScope, type PlatformScope } from './scopes';

export const PERSON_HEADER = 'x-harpium-pessoa';

export interface PlatformPerson {
  userId: string;
  email: string;
  name: string | null;
  /** The person's role in the agency team; null = not agency. */
  agencyRole: AgenciaRole | null;
}

export interface PlatformContext {
  /** Service-role client. Every query MUST filter the CRM explicitly. */
  admin: SupabaseClient;
  keyId: string;
  keyName: string;
  scopes: string[];
  person: PlatformPerson;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const value = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
  return value || null;
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** The person header, trimmed and lower-cased, or null if not an e-mail. */
export function parsePersonEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function isMissingRelation(err: { code?: string; message?: string }): boolean {
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    err.code === '42883' ||
    err.code === 'PGRST202' ||
    /schema cache|does not exist/i.test(err.message ?? '')
  );
}

export async function requirePlatformKey(
  request: Request,
  scope?: PlatformScope,
  admin: SupabaseClient = supabaseAdmin(),
): Promise<PlatformContext> {
  const presented = bearer(request);
  if (!presented || !looksLikePlatformKey(presented)) throw platformErrors.unauthorized();

  const { data: key, error: keyErr } = await admin
    .from('platform_api_keys')
    .select('id, name, scopes, revoked_at')
    .eq('key_hash', hashPlatformKey(presented))
    .maybeSingle();
  if (keyErr) {
    if (isMissingRelation(keyErr)) {
      throw platformErrors.unavailable('O CRM ainda não tem a migration 075 aplicada');
    }
    console.error('[plataforma/auth] key lookup failed:', keyErr.message);
    throw platformErrors.unauthorized();
  }
  if (!key || key.revoked_at) throw platformErrors.unauthorized();

  const limit = checkRateLimit(`plat:${key.id}`, RATE_LIMITS.platformApi);
  if (!limit.success) throw platformErrors.rateLimited(limit);

  const scopes: string[] = Array.isArray(key.scopes) ? key.scopes : [];
  if (scope && !hasPlatformScope(scopes, scope)) throw platformErrors.missingScope(scope);

  const email = parsePersonEmail(request.headers.get(PERSON_HEADER));
  if (!email) {
    throw platformErrors.badRequest(
      'Informe no cabeçalho X-Harpium-Pessoa o e-mail de quem está consultando',
    );
  }

  const { data: userId, error: userErr } = await admin.rpc('platform_user_id_by_email', {
    p_email: email,
  });
  if (userErr) {
    console.error('[plataforma/auth] person lookup failed:', userErr.message);
    throw platformErrors.noCrmLogin(email);
  }
  if (typeof userId !== 'string' || !userId) throw platformErrors.noCrmLogin(email);

  const [agencyRes, profileRes] = await Promise.all([
    admin.from('agencia_membros').select('role').eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
  ]);
  // A failed agency lookup fails closed: the person is treated as not agency.
  const agencyRow = agencyRes.error ? null : (agencyRes.data as { role?: unknown } | null);
  const agencyRole: AgenciaRole | null = agencyRow
    ? isAgenciaRole(agencyRow.role)
      ? agencyRow.role
      : 'support'
    : null;
  const fullName = (profileRes.data as { full_name?: unknown } | null)?.full_name;

  touchPlatformKey(admin, key.id);

  return {
    admin,
    keyId: key.id,
    keyName: key.name,
    scopes,
    person: {
      userId,
      email,
      name: typeof fullName === 'string' && fullName.trim() ? fullName.trim() : null,
      agencyRole,
    },
  };
}

/** Best-effort `last_used_at` bump; never fails the request. */
export function touchPlatformKey(admin: SupabaseClient, keyId: string): void {
  void admin
    .from('platform_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId)
    .then(({ error }) => {
      if (error) console.warn('[plataforma/auth] last_used_at bump failed:', error.message);
    });
}
