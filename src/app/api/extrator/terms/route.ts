// ============================================================
// POST /api/extrator/terms — the CRM's admin accepts the terms of use
// of the extractor, once per CRM (docs/plano-extrator-leads.md,
// "Papéis": the CRM's owner decides to prospect and answers for it).
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { acceptTerms } from '@/lib/extractor/store'
import { MIGRATION_PENDING } from '@/lib/extractor/types'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function POST() {
  try {
    const ctx = await requireRole('admin')
    try {
      const at = await acceptTerms(supabaseAdmin(), ctx.accountId, ctx.userId)
      return NextResponse.json({ termsAcceptedAt: at })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/does not exist|could not find the table/i.test(message)) {
        return NextResponse.json({ error: MIGRATION_PENDING }, { status: 503 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
