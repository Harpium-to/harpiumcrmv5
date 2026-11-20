import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { DEFAULT_HANDOFF_NOTICE } from '@/lib/ai/handoff'
import {
  effectiveHandoff,
  loadHandoffContext,
  resolveHandoffTarget,
  teamFromCode,
  teamsPrompt,
} from '@/lib/atendimento/destino'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'informe as mensagens' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Mande uma mensagem para testar o agente.' },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('A chave de API guardada não pôde ser decifrada.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'Nenhum agente configurado ainda. Adicione a chave do provedor em Configuração.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )
    // The setores, as the live auto-reply gives them to the AI when it
    // may choose (lib/atendimento/destino.ts), so the test shows where
    // the conversation would go.
    const handoffCtx = await loadHandoffContext(supabase, {
      accountId,
      accountUserId: config.handoffAgentId,
      agentId: null,
      agentUserId: null,
    }).catch(() => null)
    const settings = effectiveHandoff(
      null,
      handoffCtx?.account ?? { mode: null, teamId: null, userId: config.handoffAgentId },
      (handoffCtx?.teams.length ?? 0) > 0,
    )
    const teamsBlock =
      handoffCtx && settings.mode === 'ia_escolhe' ? teamsPrompt(handoffCtx.teams) : null

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      capabilities: teamsBlock ? [teamsBlock] : undefined,
    })

    const { text, handoff, handoffTeam } = await generateReply({ config, systemPrompt, messages })
    // Same rule as the live auto-reply: an empty answer is a handoff, and
    // a handoff always tells the customer something.
    const handedOff = handoff || !text
    let handoffTo: string | null = null
    if (handedOff) {
      const target = resolveHandoffTarget({
        settings,
        chosenTeamId: teamFromCode(handoffTeam ?? null, handoffCtx?.teams ?? [])?.id ?? null,
        entryTeamId: handoffCtx?.entryTeamId ?? null,
        activeTeamIds: (handoffCtx?.teams ?? []).map((t) => t.id),
      })
      if (target?.kind === 'setor') {
        handoffTo = `setor ${handoffCtx?.teams.find((t) => t.id === target.teamId)?.name ?? ''}`.trim()
      } else if (target?.kind === 'pessoa') {
        const { data: p } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('user_id', target.userId)
          .maybeSingle()
        handoffTo = (p as { full_name: string | null } | null)?.full_name || 'a pessoa escolhida'
      } else {
        handoffTo = 'fila geral'
      }
    }
    return NextResponse.json({
      reply: text || (handedOff ? DEFAULT_HANDOFF_NOTICE : ''),
      handoff: handedOff,
      handoff_to: handoffTo,
    })
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
