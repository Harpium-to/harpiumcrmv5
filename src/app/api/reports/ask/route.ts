import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { AiError } from '@/lib/ai/types'
import { loadReportBundle } from '@/lib/reports/queries'
import { rangeFromSearchParams } from '@/lib/reports/request'
import { buildAnalystPrompt } from '@/lib/reports/analyst'
import { ReportTooLargeError } from '@/lib/reports/fetch-all'

const MAX_QUESTION = 500

/**
 * POST /api/reports/ask  (agent+)
 *
 * A question in Portuguese about the current window, answered from the
 * figures the server just computed.
 *
 * The bundle is loaded here and not accepted from the client, which is
 * the whole security design of this endpoint: a caller that could
 * supply the numbers could have the analyst state them back as fact in
 * fluent prose, and a fabricated figure wrapped in analysis is far
 * more convincing than a fabricated spreadsheet.
 *
 * `agent+` rather than any member, because every call spends the
 * account's provider credit.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`reports-ask:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const question =
      typeof body?.question === 'string' ? body.question.trim() : ''
    if (question.length < 3) {
      return NextResponse.json(
        { error: 'Escreva a pergunta' },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[reports/ask] loadAiConfig error:', err)
      throw new AiError('A chave do provedor não pôde ser lida.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error:
            'Nenhum provedor de IA configurado. Adicione sua chave em Agentes › Configuração.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const url = new URL(request.url)
    const range = rangeFromSearchParams(url.searchParams)
    const bundle = await loadReportBundle(supabase, accountId, range)

    const { text, usage } = await generateReply({
      config,
      systemPrompt: buildAnalystPrompt(bundle),
      // The question travels as the user turn, never spliced into the
      // system prompt — the instructions stay above anything typed.
      messages: [{ role: 'user', content: question.slice(0, MAX_QUESTION) }],
    })

    // Fire-and-forget: `logAiUsage` swallows its own errors, so the
    // floating promise cannot reject.
    void logAiUsage(supabase, {
      accountId,
      // Not tied to a thread: this is a question about the account,
      // not about one customer.
      conversationId: null,
      mode: 'draft',
      provider: config.provider,
      model: config.model,
      usage,
    })

    return NextResponse.json({ answer: text })
  } catch (err) {
    if (err instanceof ReportTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 })
    }
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
