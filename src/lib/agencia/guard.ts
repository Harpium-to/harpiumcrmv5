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
import { supabaseAdmin } from './admin-client'

export type AgenciaGate =
  | { status: 'unauthed' }
  | { status: 'forbidden'; userId: string }
  | { status: 'ok'; userId: string; admin: SupabaseClient }

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

  return { status: 'ok', userId: user.id, admin: supabaseAdmin() }
}

/**
 * Enforce agency membership for API routes. Throws
 * `UnauthorizedError` (no session) or `ForbiddenError` (not an agency
 * member); on success returns the caller id + service-role client.
 */
export async function requireAgencia(): Promise<{
  userId: string
  admin: SupabaseClient
}> {
  const gate = await loadAgencia()
  if (gate.status === 'unauthed') {
    throw new UnauthorizedError()
  }
  if (gate.status === 'forbidden') {
    throw new ForbiddenError('Agency access required')
  }
  return { userId: gate.userId, admin: gate.admin }
}
