// ============================================================
// Map a Postgres error raised by one of our RPCs to an HTTP response.
//
// The SQL functions (018, 019, 049, 050) raise with a fixed SQLSTATE
// and a user-facing message in Portuguese:
//   42501 insufficient_privilege  → 403
//   22023 invalid_parameter_value → 400
//   23505 unique_violation        → 409
// A function that doesn't exist yet means its migration isn't
// applied: 409 with a message that says which one.
// ============================================================

import { NextResponse } from 'next/server'

import { isMissingFunction } from '@/lib/auth/account-context'

interface RpcError {
  code?: string
  message?: string
}

export function rpcErrorStatus(err: RpcError): number {
  switch (err.code) {
    case '42501':
      return 403
    case '22023':
      return 400
    case '23505':
      return 409
    default:
      return isMissingFunction(err) ? 409 : 500
  }
}

export function rpcErrorToResponse(
  err: RpcError,
  opts: { fallback: string; migration?: string; log?: string },
): NextResponse {
  const status = rpcErrorStatus(err)
  if (isMissingFunction(err)) {
    return NextResponse.json(
      {
        error: opts.migration
          ? `Isto exige a migration ${opts.migration} aplicada no Supabase.`
          : 'Isto exige uma migration que ainda não foi aplicada.',
      },
      { status },
    )
  }
  if (status === 500) {
    console.error(`[${opts.log ?? 'rpc'}] unexpected RPC error:`, err)
    return NextResponse.json({ error: opts.fallback }, { status })
  }
  return NextResponse.json({ error: err.message ?? opts.fallback }, { status })
}
