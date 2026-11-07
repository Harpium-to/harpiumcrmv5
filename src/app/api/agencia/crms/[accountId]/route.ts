// ============================================================
// PATCH /api/agencia/crms/[accountId] — platform fields of a CRM.
//
// Body (any subset): { name, status, niche, managerUserId, notes }
//
// The rules live in agencia_update_account (migration 050): managers
// only touch their portfolio; archiving and reassigning the manager
// are super_admin only; every change is audited. This route only
// shapes the patch.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { isCrmNiche, isCrmStatus } from '@/lib/agencia/crm'
import { toErrorResponse } from '@/lib/auth/account'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    await requireAgencia('manager')
    const { accountId } = await params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
    }

    const patch: Record<string, string> = {}
    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return NextResponse.json({ error: 'Dê um nome ao CRM.' }, { status: 400 })
      }
      patch.name = body.name.trim()
    }
    if ('status' in body) {
      if (!isCrmStatus(body.status)) {
        return NextResponse.json({ error: 'Status inválido.' }, { status: 400 })
      }
      patch.status = body.status
    }
    if ('niche' in body) {
      if (body.niche !== '' && body.niche !== null && !isCrmNiche(body.niche)) {
        return NextResponse.json({ error: 'Nicho inválido.' }, { status: 400 })
      }
      patch.niche = (body.niche as string | null) ?? ''
    }
    if ('managerUserId' in body) {
      patch.manager_user_id =
        typeof body.managerUserId === 'string' ? body.managerUserId : ''
    }
    if ('notes' in body) {
      patch.notes = typeof body.notes === 'string' ? body.notes : ''
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nada para alterar.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { error } = await supabase.rpc('agencia_update_account', {
      p_account_id: accountId,
      p_patch: patch,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao salvar o CRM',
        migration: '050',
        log: 'PATCH /api/agencia/crms/[accountId]',
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
