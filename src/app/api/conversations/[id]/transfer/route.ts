import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  TransferError,
  transferirConversa,
  type TransferTarget,
} from '@/lib/atendimento/transferir'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/conversations/[id]/transfer  (agent+)
 *
 * The inbox's "Transferir", "Assumir" and "Pegar".
 *
 * Body:
 *   { para: 'pessoa', pessoa_id, nota? }  to a teammate
 *   { para: 'setor',  setor_id,  nota? }  to a setor — its rule picks who
 *   { para: 'mim',    pegar? }            to the caller; with `pegar`,
 *                                         only while nobody owns it
 *   { para: 'fila',   nota? }             back to the shared queue
 *
 * Goes through the caller's RLS-scoped client, so the database
 * function sees who is acting (and refuses a viewer, or a conversation
 * of another CRM). Answers { ok, changed, reason?, to_user_id, team_id }:
 * "already taken" and "nobody available" are answers, not errors.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, userId } = await requireRole('agent')

    const limit = checkRateLimit(`transfer:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return bad('Corpo da requisição inválido')

    const para = body.para
    let target: TransferTarget
    if (para === 'pessoa') {
      if (typeof body.pessoa_id !== 'string' || !body.pessoa_id) return bad('Escolha a pessoa')
      target = { kind: 'pessoa', userId: body.pessoa_id }
    } else if (para === 'setor') {
      if (typeof body.setor_id !== 'string' || !body.setor_id) return bad('Escolha o setor')
      target = { kind: 'setor', teamId: body.setor_id }
    } else if (para === 'mim') {
      target = { kind: 'pessoa', userId }
    } else if (para === 'fila') {
      target = { kind: 'ninguem' }
    } else {
      return bad('Informe para quem passar: pessoa, setor, mim ou fila')
    }

    const nota = typeof body.nota === 'string' ? body.nota : null
    if (nota && nota.trim().length > 500) return bad('A nota pode ter até 500 caracteres')

    const result = await transferirConversa(supabase, {
      conversationId: id,
      target,
      source: 'manual',
      note: nota,
      onlyIfUnassigned: para === 'mim' && body.pegar === true,
    })

    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    return NextResponse.json({
      ok: result.ok,
      changed: result.changed,
      reason: result.reason ?? null,
      to_user_id: result.toUserId,
      team_id: result.teamId,
    })
  } catch (err) {
    if (err instanceof TransferError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}
