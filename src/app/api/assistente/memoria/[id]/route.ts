import { NextResponse } from 'next/server'

import { fail, resolve } from '@/lib/assistente/http'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** DELETE /api/assistente/memoria/[id] (agent+) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Item inválido' }, { status: 400 })
  try {
    const { ctx } = await resolve()
    if (ctx.readOnly) return NextResponse.json({ error: 'Seu acesso é só de leitura.' }, { status: 403 })
    const { data, error } = await ctx.admin
      .from('assistant_memory')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
