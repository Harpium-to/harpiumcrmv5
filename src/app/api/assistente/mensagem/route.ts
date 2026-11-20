import { NextResponse } from 'next/server'

import { expireStale } from '@/lib/assistente/actions'
import { fail, notReady, rateLimit, readiness, resolve, zoneFrom } from '@/lib/assistente/http'
import { appendMessage, createConversation, titleFrom } from '@/lib/assistente/store'
import { pageFrom, streamStep } from '@/lib/assistente/turn'

// One model call per request; the AI may take a while to answer.
export const maxDuration = 60

const MAX_TEXT = 4_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/assistente/mensagem  (any member; viewers only get reads)
 *
 * { text, conversationId?, page?: { path, search }, timezone? }
 *
 * Saves what the person typed (opening a conversation if needed) and
 * runs the first step, streamed. The panel then calls /passo while
 * the answer says "continue".
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Escreva alguma coisa.' }, { status: 400 })
    if (text.length > MAX_TEXT) {
      return NextResponse.json({ error: `Até ${MAX_TEXT} caracteres por mensagem.` }, { status: 400 })
    }

    const { ctx } = await resolve(zoneFrom(body, request))
    const ready = await readiness(ctx)
    if (!ready.ready) return notReady(ready)
    const limited = rateLimit(ctx, 'message') ?? rateLimit(ctx, 'step')
    if (limited) return limited

    let conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null
    if (conversationId) {
      if (!UUID.test(conversationId)) return NextResponse.json({ error: 'Conversa inválida' }, { status: 400 })
      const { data } = await ctx.db
        .from('assistant_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (!data) conversationId = null
    }
    if (!conversationId) {
      conversationId = await createConversation(ctx.db, {
        accountId: ctx.accountId,
        userId: ctx.userId,
        title: titleFrom(text),
      })
    } else {
      await expireStale(ctx.admin, conversationId)
    }

    const page = pageFrom(body)
    await appendMessage(ctx.db, {
      conversationId,
      accountId: ctx.accountId,
      role: 'user',
      content: { text, ...(page ? { page: page.path } : {}) },
    })

    return streamStep({ ctx, ready, conversationId, page })
  } catch (err) {
    return fail(err)
  }
}
