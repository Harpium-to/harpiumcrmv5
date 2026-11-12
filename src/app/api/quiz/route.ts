// ============================================================
// GET  /api/quiz — the CRM's quizzes with their numbers, and the
//                  models a new one can start from
// POST /api/quiz — create one  { name, model? | agencyModelId? | duplicateOf? }
//
// Members read; admins create (migration 072).
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { listAgencyModels, loadAgencyModel } from '@/lib/quiz/agency-models'
import { createQuiz, getQuiz, listQuizzes, MIGRATION_PENDING } from '@/lib/quiz/store'
import { findQuizModel, QUIZ_MODELS } from '@/lib/quiz/templates'
import { sanitizeDefinition } from '@/lib/quiz/validate'
import type { QuizDefinition } from '@/lib/quiz/types'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const quizzes = await listQuizzes(ctx.supabase, ctx.accountId)
    const models = QUIZ_MODELS.map(({ key, name, description }) => ({ key, name, description }))
    if (quizzes === null) {
      return NextResponse.json({ available: false, error: MIGRATION_PENDING, quizzes: [], models, agencyModels: [] })
    }
    const agencyModels = await listAgencyModels(supabaseAdmin())
    return NextResponse.json({ available: true, quizzes, models, agencyModels })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    let name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
    const admin = supabaseAdmin()

    let definition: QuizDefinition | null = null
    if (typeof body?.duplicateOf === 'string') {
      const source = await getQuiz(ctx.supabase, ctx.accountId, body.duplicateOf)
      if (!source) return NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })
      definition = sanitizeDefinition(source.draft)
      name = name || `${source.name} (cópia)`.slice(0, 120)
    } else if (typeof body?.agencyModelId === 'string') {
      const model = await loadAgencyModel(admin, body.agencyModelId)
      if (!model) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
      definition = model.definition
      name = name || model.name
    } else {
      const model = findQuizModel(typeof body?.model === 'string' ? body.model : 'em-branco')
      if (!model) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
      definition = model.definition
      name = name || (model.key === 'em-branco' ? '' : model.name)
    }
    if (!name) return NextResponse.json({ error: 'Dê um nome ao quiz.' }, { status: 400 })

    try {
      const quiz = await createQuiz(admin, {
        accountId: ctx.accountId,
        userId: ctx.userId,
        name,
        definition,
      })
      return NextResponse.json({ id: quiz.id, slug: quiz.slug }, { status: 201 })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/does not exist|could not find the table/i.test(message)) {
        return NextResponse.json({ error: MIGRATION_PENDING }, { status: 503 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
