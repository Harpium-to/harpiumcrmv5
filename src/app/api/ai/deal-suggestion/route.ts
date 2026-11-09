import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { generateReply } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'
import {
  buildDealSuggestionPrompt,
  conversationTranscript,
  parseDealSuggestion,
  todayInBrazil,
  type DealSuggestionStage,
} from '@/lib/ai/deal-suggestion'

/**
 * POST /api/ai/deal-suggestion  (agent+)
 *
 * Body: { conversation_id, pipeline_id }
 * Returns: { suggestion: { title, value, expected_close_date, stage_id, notes } }
 *
 * The inbox's "Novo negócio" button opens the deal form and asks this
 * route to fill it from the conversation. Read-only, like the reply
 * draft: it saves nothing — the person reviews the form and saves.
 * Uses the account's own AI key (BYO) and shares the draft's limits.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-deal:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-deal-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    const pipelineId =
      body && typeof body.pipeline_id === 'string' ? body.pipeline_id : ''
    if (!conversationId || !pipelineId) {
      return NextResponse.json(
        { error: 'informe conversation_id e pipeline_id' },
        { status: 400 },
      )
    }

    // RLS scopes the SSR client to the caller's account: a missing row
    // means "not yours / not found" either way.
    const [convRes, stagesRes, acctRes] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, contact:contacts(name, phone)')
        .eq('id', conversationId)
        .maybeSingle(),
      supabase
        .from('pipeline_stages')
        .select('id, name')
        .eq('pipeline_id', pipelineId)
        .order('position'),
      supabase
        .from('accounts')
        .select('default_currency')
        .eq('id', accountId)
        .maybeSingle(),
    ])
    if (convRes.error || stagesRes.error) {
      console.error('[ai/deal-suggestion] lookup error:', convRes.error ?? stagesRes.error)
      return NextResponse.json({ error: 'Falha ao carregar a conversa' }, { status: 500 })
    }
    if (!convRes.data) {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }
    const stages = (stagesRes.data ?? []) as DealSuggestionStage[]
    if (stages.length === 0) {
      return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[ai/deal-suggestion] loadAiConfig error:', err)
      throw new AiError('A chave de API guardada não pôde ser decifrada.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'O assistente de IA não está configurado. Ative em Agentes › Configuração.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Ainda não há mensagens para resumir.', code: 'no_messages' },
        { status: 400 },
      )
    }

    const contact = (convRes.data as { contact?: { name?: string | null; phone?: string | null } | null })
      .contact
    const today = todayInBrazil()
    const systemPrompt = buildDealSuggestionPrompt({
      contactName: contact?.name || contact?.phone || null,
      stages,
      currency:
        (acctRes.data as { default_currency?: string } | null)?.default_currency ?? 'BRL',
      today,
    })

    // One user turn holding the whole transcript, so the model reads
    // the conversation instead of answering the customer's last line.
    const { text, usage } = await generateReply({
      config,
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Conversa:\n${conversationTranscript(messages)}\n\nResponda só com o JSON.`,
        },
      ],
    })

    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/deal-suggestion] usage log skipped:', logErr)
    }

    const suggestion = parseDealSuggestion(text, { stages, today })
    if (!suggestion) {
      return NextResponse.json(
        {
          error: 'A IA não devolveu um resumo utilizável. Tente de novo.',
          code: 'unparseable',
        },
        { status: 502 },
      )
    }

    return NextResponse.json({ suggestion })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
