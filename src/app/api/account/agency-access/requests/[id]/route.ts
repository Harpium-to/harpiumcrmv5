// ============================================================
// POST /api/account/agency-access/requests/[id] — the owner answers
// an agency access request. Body: { approve: boolean }
//
// decide_agency_access_request (051) checks that the caller owns the
// active CRM and that the request belongs to it; approving goes
// through set_agency_access, so the change lands in the history.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { approve?: unknown } | null
    if (typeof body?.approve !== 'boolean') {
      return NextResponse.json({ error: 'Informe approve (true ou false).' }, { status: 400 })
    }

    const { error } = await ctx.supabase.rpc('decide_agency_access_request', {
      p_request_id: id,
      p_approve: body.approve,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao responder o pedido',
        migration: '051',
        log: 'POST agency-access/requests/[id]',
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
