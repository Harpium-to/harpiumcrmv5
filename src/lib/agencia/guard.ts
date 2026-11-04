// ============================================================
// Agency super-vision guard — server-only.
//
// Membership check flows through the `is_agencia()` SECURITY DEFINER
// RPC (migration 037): it runs as the *caller's* session, reads
// auth.uid() internally, and returns a boolean. That keeps the
// "am I agency?" question a single round trip and independent of the
// caller's own RLS.
//
// Two entry points:
//   - `loadAgencia()`   — non-throwing; returns a discriminated result
//                         so server components / layouts can `redirect`
//                         differently for "not signed in" vs "signed in
//                         but not agency".
//   - `requireAgencia()` — throws Unauthorized/Forbidden (reusing the
//                         auth/account error classes) for API routes,
//                         which pair it with `toErrorResponse`.
//
// Both hand back the service-role `admin` client on success — the
// console reads/writes every account through it (see admin-client.ts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { isMissingFunction } from '@/lib/auth/account-context'
import { supabaseAdmin } from './admin-client'
import { hasAgenciaRole, isAgenciaRole, type AgenciaRole } from './roles'

export type AgenciaGate =
  | { status: 'unauthed' }
  | { status: 'forbidden'; userId: string }
  | { status: 'ok'; userId: string; role: AgenciaRole; admin: SupabaseClient }

/**
 * Resolve the caller's agency status without throwing.
 *
 *   - `unauthed`  — no Supabase session.
 *   - `forbidden` — signed in, but not an agency member.
 *   - `ok`        — agency member; `admin` is the service-role client.
 */
export async function loadAgencia(): Promise<AgenciaGate> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) {
    return { status: 'unauthed' }
  }

  // `is_agencia()` takes no args — it asks about auth.uid() itself.
  const { data, error } = await supabase.rpc('is_agencia')
  if (error) {
    // A failed membership probe must fail closed: treat as forbidden
    // rather than silently granting the service-role client.
    console.error('[loadAgencia] is_agencia rpc error:', error)
    return { status: 'forbidden', userId: user.id }
  }

  if (data !== true) {
    return { status: 'forbidden', userId: user.id }
  }

  return {
    status: 'ok',
    userId: user.id,
    role: await loadAgenciaRole(supabase),
    admin: supabaseAdmin(),
  }
}

/**
 * The caller's platform role (migration 049). Before 049 there are no
 * roles and every agency member has always had full power, so a
 * missing function reads as super_admin. Any other failure — or a
 * value this code doesn't know — reads as the least privileged role.
 */
async function loadAgenciaRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<AgenciaRole> {
  const { data, error } = await supabase.rpc('agencia_role')
  if (error) {
    if (isMissingFunction(error)) return 'super_admin'
    console.error('[loadAgencia] agencia_role rpc error:', error)
    return 'support'
  }
  return isAgenciaRole(data) ? data : 'support'
}

/**
 * Enforce agency membership for API routes. Throws
 * `UnauthorizedError` (no session) or `ForbiddenError` (not an agency
 * member); on success returns the caller id + service-role client.
 */
export async function requireAgencia(minRole: AgenciaRole = 'support'): Promise<{
  userId: string
  role: AgenciaRole
  admin: SupabaseClient
}> {
  const gate = await loadAgencia()
  if (gate.status === 'unauthed') {
    throw new UnauthorizedError()
  }
  if (gate.status === 'forbidden') {
    throw new ForbiddenError('Acesso restrito à agência')
  }
  if (!hasAgenciaRole(gate.role, minRole)) {
    throw new ForbiddenError('Seu papel na agência não permite esta ação')
  }
  return { userId: gate.userId, role: gate.role, admin: gate.admin }
}
