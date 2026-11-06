// ============================================================
// POST /api/agencia/crms/[accountId]/modelo — apply a template to a CRM.
// Body: { templateId }
//
// agencia_apply_template (migration 053) checks the operator, the
// portfolio and the owner's consent (onboarding, or full access), and
// only adds what isn't there yet.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { describeApplySummary } from '@/lib/agencia/templates'
import { toErrorResponse } from '@/lib/auth/account'
import { rpcErrorToResponse } from '@/lib/supabase/rpc-error'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    await requireAgencia('manager')
    const { accountId } = await params
    const body = (await request.json().catch(() => null)) as { templateId?: unknown } | null
    if (typeof body?.templateId !== 'string' || !body.templateId) {
      return NextResponse.json({ error: 'Escolha um modelo.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('agencia_apply_template', {
      p_account_id: accountId,
      p_template_id: body.templateId,
    })
    if (error) {
      return rpcErrorToResponse(error, {
        fallback: 'Falha ao aplicar o modelo',
        migration: '053',
        log: 'POST crms/[accountId]/modelo',
      })
    }
    const summary = (data ?? {}) as Record<string, unknown>
    return NextResponse.json({ summary, text: describeApplySummary(summary) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
