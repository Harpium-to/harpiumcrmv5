// ============================================================
// DELETE /api/agencia/quiz-modelos/{id} — remove an agency quiz model.
//
// The quizzes already created from it are copies and stay as they are.
// ============================================================

import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'
import { deleteAgencyModel } from '@/lib/quiz/agency-models'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin } = await requireAgencia('manager')
    const { id } = await params
    const removed = await deleteAgencyModel(admin, id)
    if (!removed) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
