// An automation belongs to a CRM (`automations.account_id`), not to the
// member who created it — `user_id` only records who did. Anyone in the
// active CRM opens it; agent+ edits and deletes it, the same rule the
// 017 RLS policies state. Writes go through the service-role client,
// which bypasses RLS, so the CRM and the role are enforced here.

import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
  type AccountContext,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let ctx: AccountContext
  try {
    ctx = await getCurrentAccount()
  } catch (err) {
    return toErrorResponse(err)
  }

  // RLS already limits this client to the active CRM; the explicit
  // filter keeps an id from another CRM a 404 without leaning on the
  // policy alone.
  const { data: automation, error } = await ctx.supabase
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!automation) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const steps = await loadStepsTree(id)
  return NextResponse.json({ automation, steps })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Editing an automation is a write — the RLS automations_update policy
  // requires `agent`, but this route mutates via the service-role client
  // which bypasses RLS, so enforce the role here.
  let ctx: AccountContext
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  const admin = supabaseAdmin()

  // The automation has to be in the caller's active CRM before we touch
  // anything. Load the fields we need to compute the post-patch
  // "effective" state for validation.
  const { data: existing, error: readErr } = await admin
    .from('automations')
    .select('id, is_active, trigger_type, trigger_config')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'is_active',
  ] as const) {
    if (k in body) update[k] = body[k]
  }

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the
  // merged configuration first. Activation is the natural gate — drafts
  // are still allowed to be incomplete.
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps, mergedTriggerType),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Não dá para manter ativa uma automação com configuração inválida',
          issues,
        },
        { status: 400 },
      )
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await admin
      .from('automations')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, body.steps as BuilderStepInput[])
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Deleting an automation is a write — enforce `agent` (the service-role
  // client below bypasses the agent-gated automations_delete RLS).
  let ctx: AccountContext
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  // Steps, logs and pending runs go with it (ON DELETE CASCADE, 006).
  const { data, error } = await supabaseAdmin()
    .from('automations')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Nothing was deleted: the id isn't in this CRM, or is already gone.
  if (!data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
