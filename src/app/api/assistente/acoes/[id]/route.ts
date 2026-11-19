import { NextResponse } from 'next/server'

import { cancelAction, confirmAction, loadView, pendingCount, undoAction } from '@/lib/assistente/actions'
import { fail, readiness, resolve, zoneFrom } from '@/lib/assistente/http'
import { DEFAULT_SETTINGS } from '@/lib/assistente/session'

export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DECISIONS = ['confirmar', 'cancelar', 'ajustar', 'desfazer'] as const

/**
 * POST /api/assistente/acoes/[id]  { decisao: confirmar | cancelar | ajustar | desfazer }
 *
 * A person's answer to a card. "confirmar" executes the exact input
 * the card was built from, once. Answers with the conversation as it
 * now stands and whether the model should take a turn (`continue`:
 * true after a confirmation, when no other card is still waiting).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Cartão inválido' }, { status: 400 })
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const decision = body?.decisao
    if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
      return NextResponse.json({ error: 'Decisão inválida' }, { status: 400 })
    }
    const { ctx } = await resolve(zoneFrom(body, request))

    let conversationId: string | null = null
    let message: string | null = null
    let ok = true
    if (decision === 'confirmar') {
      const ready = await readiness(ctx)
      const settings = ready.ready ? ready.settings : DEFAULT_SETTINGS
      const r = await confirmAction(ctx, id, settings)
      conversationId = r.conversationId
      if (r.outcome === 'done') message = r.summary
      else if (r.outcome === 'failed') {
        ok = false
        message = r.error
      } else if (r.outcome === 'expired') {
        ok = false
        message = 'Esse cartão expirou. Peça de novo ao Harpi.'
      } else if (r.outcome === 'already') message = 'Esse cartão já foi respondido.'
    } else if (decision === 'desfazer') {
      const r = await undoAction(ctx, id)
      message = r.summary
      const { data } = await ctx.admin.from('assistant_actions').select('conversation_id').eq('id', id).maybeSingle()
      conversationId = (data as { conversation_id?: string } | null)?.conversation_id ?? null
    } else {
      const r = await cancelAction(ctx, id, decision === 'ajustar' ? 'ajustar' : 'cancelar')
      conversationId = r.conversationId
    }

    const items = conversationId ? await loadView(ctx, conversationId) : []
    const pending = conversationId ? await pendingCount(ctx.admin, conversationId) : 0
    return NextResponse.json({
      ok,
      message,
      conversationId,
      items,
      pending,
      continue: decision === 'confirmar' && pending === 0 && !!conversationId,
    })
  } catch (err) {
    return fail(err)
  }
}
