import { NextResponse } from 'next/server'

import { fail, notReady, rateLimit, readiness, resolve, zoneFrom } from '@/lib/assistente/http'
import { pageFrom, streamStep } from '@/lib/assistente/turn'

export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/assistente/passo  { conversationId, page?, timezone? }
 *
 * The next model turn of a conversation: after tool results came in,
 * or after a card was confirmed. Streamed like /mensagem.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    if (!UUID.test(conversationId)) return NextResponse.json({ error: 'Conversa inválida' }, { status: 400 })

    const { ctx } = await resolve(zoneFrom(body, request))
    const ready = await readiness(ctx)
    if (!ready.ready) return notReady(ready)
    const limited = rateLimit(ctx, 'step')
    if (limited) return limited

    const { data } = await ctx.db
      .from('assistant_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })

    return streamStep({ ctx, ready, conversationId, page: pageFrom(body) })
  } catch (err) {
    return fail(err)
  }
}
