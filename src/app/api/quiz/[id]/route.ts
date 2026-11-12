// ============================================================
// GET    /api/quiz/{id} — one quiz, with its draft and what still
//                         stops it from being published
// PATCH  /api/quiz/{id} — { name?, slug?, draft?, action?, capiToken? }
//                         action: 'publish' | 'pause' | 'resume'
// DELETE /api/quiz/{id} — the quiz and every visit recorded for it
//
// Members read; admins write (migration 072). A draft is saved in any
// state; publishing copies it to the live definition and asks for no
// errors (lib/quiz/validate.ts).
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/leads/admin-client'
import { hasCapiToken, saveCapiToken } from '@/lib/quiz/capi'
import { slugProblem } from '@/lib/quiz/slug'
import {
  deleteQuiz,
  getQuiz,
  SlugTakenError,
  summarize,
  updateQuiz,
  type QuizPatch,
  type QuizRow,
} from '@/lib/quiz/store'
import { checkDefinition, sanitizeDefinition } from '@/lib/quiz/validate'

type Params = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: 'Quiz não encontrado.' }, { status: 404 })

async function describe(row: QuizRow, canManage: boolean) {
  const draft = sanitizeDefinition(row.draft)
  return {
    quiz: {
      ...summarize(row),
      draft,
      check: checkDefinition(draft),
      // Only who can edit learns whether a token is saved; never its value.
      hasCapiToken: canManage ? await hasCapiToken(supabaseAdmin(), row.id) : false,
    },
  }
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const row = await getQuiz(ctx.supabase, ctx.accountId, id)
    if (!row) return notFound()
    return NextResponse.json(await describe(row, hasMinRole(ctx.role, 'admin')))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Formato inválido.' }, { status: 400 })

    const admin = supabaseAdmin()
    const current = await getQuiz(admin, ctx.accountId, id)
    if (!current) return notFound()

    const patch: QuizPatch = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 120)
      if (!name) return NextResponse.json({ error: 'Dê um nome ao quiz.' }, { status: 400 })
      patch.name = name
    }
    if (typeof body.slug === 'string') {
      const slug = body.slug.trim().toLowerCase()
      if (slug !== current.slug) {
        const problem = slugProblem(slug)
        if (problem) return NextResponse.json({ error: problem }, { status: 400 })
        patch.slug = slug
      }
    }
    if (body.draft !== undefined) patch.draft = sanitizeDefinition(body.draft)

    if (body.action === 'publish') {
      const draft = patch.draft ?? sanitizeDefinition(current.draft)
      const check = checkDefinition(draft)
      if (check.errors.length > 0) {
        return NextResponse.json(
          { error: 'Ainda falta ajustar antes de publicar.', problems: check.errors },
          { status: 422 },
        )
      }
      patch.draft = draft
      patch.publish = true
    } else if (body.action === 'pause') {
      if (current.status === 'published') patch.status = 'paused'
    } else if (body.action === 'resume') {
      if (current.published == null) {
        return NextResponse.json({ error: 'Este quiz ainda não foi publicado.' }, { status: 400 })
      }
      patch.status = 'published'
    }

    if (typeof body.capiToken === 'string') {
      await saveCapiToken(admin, { id: current.id, accountId: ctx.accountId }, body.capiToken.slice(0, 600))
    }

    try {
      const row = await updateQuiz(admin, ctx.accountId, id, patch)
      if (!row) return notFound()
      return NextResponse.json(await describe(row, true))
    } catch (err) {
      if (err instanceof SlugTakenError) {
        return NextResponse.json({ error: err.message }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const removed = await deleteQuiz(supabaseAdmin(), ctx.accountId, id)
    if (!removed) return notFound()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
