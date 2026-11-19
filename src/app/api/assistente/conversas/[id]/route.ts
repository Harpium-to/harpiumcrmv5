import { NextResponse } from 'next/server'

import { expireStale, loadView, pendingCount } from '@/lib/assistente/actions'
import { fail, resolve } from '@/lib/assistente/http'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GET /api/assistente/conversas/[id] — one conversation as the panel draws it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Conversa inválida' }, { status: 400 })
  try {
    const { ctx } = await resolve(new URL(request.url).searchParams.get('tz'))
    const { data: conv } = await ctx.db
      .from('assistant_conversations')
      .select('id, title, origin')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    await expireStale(ctx.admin, id)
    const [items, pending] = await Promise.all([loadView(ctx, id), pendingCount(ctx.admin, id)])
    return NextResponse.json({ conversation: conv, items, pending })
  } catch (err) {
    return fail(err)
  }
}

/** DELETE /api/assistente/conversas/[id] — forget a conversation (LGPD). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Conversa inválida' }, { status: 400 })
  try {
    const { ctx } = await resolve()
    const { data, error } = await ctx.db
      .from('assistant_conversations')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
