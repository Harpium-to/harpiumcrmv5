// ============================================================
// GET  /api/agencia/quiz-modelos — the agency's quiz models
// POST /api/agencia/quiz-modelos — save a quiz as a model
//                                  { quizId, name, description? }
//
// A model is offered to every CRM in "Novo quiz" (migration 072). It
// is saved from a quiz of the CRM the agency person is working in
// right now, and keeps only the definition: no visits, no leads, no
// Pixel ID, no logo.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { listAgencyModels, saveAgencyModel } from '@/lib/quiz/agency-models'
import { getQuiz, isMissingTable, MIGRATION_PENDING } from '@/lib/quiz/store'

export async function GET() {
  try {
    const { admin } = await requireAgencia()
    return NextResponse.json({ models: await listAgencyModels(admin) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { admin, userId } = await requireAgencia('manager')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
    const description =
      typeof body?.description === 'string' ? body.description.trim().slice(0, 300) : ''
    if (!name) return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 })
    if (typeof body?.quizId !== 'string') {
      return NextResponse.json({ error: 'Escolha o quiz.' }, { status: 400 })
    }

    // Read with the caller's own session: only a quiz of the CRM they
    // are in, and may see, can become a model.
    const ctx = await getCurrentAccount()
    const quiz = await getQuiz(ctx.supabase, ctx.accountId, body.quizId)
    if (!quiz) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })

    try {
      const id = await saveAgencyModel(admin, {
        name,
        description: description || null,
        definition: quiz.draft,
        userId,
      })
      return NextResponse.json({ id }, { status: 201 })
    } catch (err) {
      if (isMissingTable({ message: err instanceof Error ? err.message : '' })) {
        return NextResponse.json({ error: MIGRATION_PENDING }, { status: 503 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
