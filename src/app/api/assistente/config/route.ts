import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/account'
import { fail, resolve } from '@/lib/assistente/http'
import { defaultAssistantModel, loadAssistantSettings } from '@/lib/assistente/session'
import { loadAiConfig } from '@/lib/ai/config'

/** GET /api/assistente/config — the CRM's Harpi switches (any member reads). */
export async function GET() {
  try {
    const { ctx } = await resolve()
    const [settings, ai] = await Promise.all([
      loadAssistantSettings(ctx.db, ctx.accountId),
      loadAiConfig(ctx.db, ctx.accountId, { requireActive: false }).catch(() => null),
    ])
    return NextResponse.json({
      settings,
      provider: ai?.provider ?? null,
      replyModel: ai?.model ?? null,
      defaultModel: ai ? defaultAssistantModel(ai.provider, ai.model) : null,
      hasKey: !!ai,
      canEdit: ctx.role === 'owner' || ctx.role === 'admin',
    })
  } catch (err) {
    return fail(err)
  }
}

/**
 * PATCH /api/assistente/config  (admin+)
 * { enabled?, model? (null = padrão), smallChanges? }
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: "'enabled' precisa ser true/false" }, { status: 400 })
      update.assistant_enabled = body.enabled
    }
    if ('smallChanges' in body) {
      if (typeof body.smallChanges !== 'boolean') return NextResponse.json({ error: "'smallChanges' precisa ser true/false" }, { status: 400 })
      update.assistant_small_changes = body.smallChanges
    }
    if ('model' in body) {
      const model = typeof body.model === 'string' ? body.model.trim() : ''
      if (model.length > 100 || /\s/.test(model)) return NextResponse.json({ error: 'Nome de modelo inválido' }, { status: 400 })
      update.assistant_model = model || null
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nada a mudar' }, { status: 400 })
    const { data, error } = await supabase
      .from('ai_configs')
      .update(update)
      .eq('account_id', accountId)
      .select('account_id')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: 'Cadastre primeiro a chave de IA em Agentes › Chave e modelo.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
