// ============================================================
// PATCH /api/agencia/crms/{accountId}/extrator  { monthlyLimit: number | null }
//
// The agency sets how many leads a CRM may extract a month (migration
// 073); null puts the default back. Managers and super admins only —
// the cost of Google Maps is the agency's.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'
import { setMonthlyLimit } from '@/lib/extractor/store'
import { MIGRATION_PENDING } from '@/lib/extractor/types'

export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const { admin } = await requireAgencia('manager')
    const { accountId } = await params
    const body = (await request.json().catch(() => null)) as { monthlyLimit?: unknown } | null
    const raw = body?.monthlyLimit
    const limit = raw === null || raw === '' ? null : Math.round(Number(raw))
    if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 100000)) {
      return NextResponse.json({ error: 'O limite vai de 0 a 100.000 leads por mês.' }, { status: 400 })
    }
    const { data: account } = await admin.from('accounts').select('id').eq('id', accountId).maybeSingle()
    if (!account) return NextResponse.json({ error: 'CRM não encontrado.' }, { status: 404 })
    try {
      await setMonthlyLimit(admin, accountId, limit)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/does not exist|could not find the table/i.test(message)) {
        return NextResponse.json({ error: MIGRATION_PENDING }, { status: 503 })
      }
      throw err
    }
    return NextResponse.json({ monthlyLimit: limit })
  } catch (err) {
    return toErrorResponse(err)
  }
}
