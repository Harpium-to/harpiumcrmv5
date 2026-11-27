import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { updateMemoryContent } from '@/lib/agents/memory'

/** PATCH: correct what an agent remembers (admin+). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireRole('admin')
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content || content.length > 2000) {
      return NextResponse.json({ error: 'O texto precisa ter entre 1 e 2000 caracteres.' }, { status: 400 })
    }
    // Service role: agent_memory has no update policy (the runner owns
    // it). The account filter inside keeps it to this CRM.
    const ok = await updateMemoryContent(supabaseAdmin(), { accountId, id, content })
    if (!ok) return NextResponse.json({ error: 'Memória não encontrada.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE: forget it (admin+; RLS allows admins to delete). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabase.from('agent_memory').delete().eq('id', id).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
