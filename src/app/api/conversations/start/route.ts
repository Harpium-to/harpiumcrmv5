import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { transferirConversa } from '@/lib/atendimento/transferir'
import { StartConversationError, startConversation } from '@/lib/inbox/start-conversation'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/conversations/start  (agent+)
 *
 * The inbox's "Nova conversa": { phone, name? } → the conversation with
 * that number, created when it doesn't exist yet. Answers
 * { conversation_id, contact_created, provider }.
 *
 * Who asks is checked here (requireRole); the find-or-create runs on
 * the service client, like the public API's send-by-phone. The
 * conversation then goes to whoever opened it, but only while nobody
 * owns it — reopening a number a teammate is handling doesn't take it.
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('agent')

    const limit = checkRateLimit(`conversation-start:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const phone = typeof body?.phone === 'string' ? body.phone : ''
    const name = typeof body?.name === 'string' ? body.name : null
    if (!phone.trim()) {
      return NextResponse.json({ error: 'Digite o número do WhatsApp' }, { status: 400 })
    }

    const started = await startConversation(supabaseAdmin(), { accountId, phone, name })

    try {
      await transferirConversa(supabase, {
        conversationId: started.conversationId,
        target: { kind: 'pessoa', userId },
        source: 'manual',
        note: null,
        onlyIfUnassigned: true,
      })
    } catch (err) {
      // The conversation exists either way; ownership is a nicety.
      console.warn('[conversations/start] assign failed:', err)
    }

    return NextResponse.json({
      conversation_id: started.conversationId,
      contact_created: started.contactCreated,
      provider: started.provider,
    })
  } catch (err) {
    if (err instanceof StartConversationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
