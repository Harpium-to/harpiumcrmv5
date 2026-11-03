import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { AiError } from '@/lib/ai/types'
import { draftAgent } from '@/lib/agents/factory'
import { bad } from '@/lib/agents/payload'

/**
 * POST /api/agents/factory  (admin+)
 *
 * Natural-language description in, a reviewable agent configuration
 * out. Nothing is written: the route returns a draft the operator sees
 * in the form and saves (or discards) themselves. Generating straight
 * into the database would mean an agent existed before anyone read
 * what it was told to do.
 *
 * Runs on the account's own provider key, like every other AI call
 * here. `requireActive: false` so an admin can draft agents before
 * flipping the account's master AI switch on — the same allowance the
 * playground gets.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(
      `agent-factory:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const description =
      body && typeof body === 'object' && typeof body.description === 'string'
        ? body.description.trim()
        : ''
    if (description.length < 15) {
      return bad('Descreva o agente com um pouco mais de detalhe.')
    }
    if (description.length > 2000) {
      return bad('A descrição deve ter no máximo 2000 caracteres.')
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    })
    if (!config) {
      return bad('Configure a chave de IA da conta antes de usar a fábrica.')
    }

    const draft = await draftAgent(config, description)
    return NextResponse.json({ draft })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    if (err instanceof Error && err.message.includes('configuração válida')) {
      return bad(err.message)
    }
    return toErrorResponse(err)
  }
}
