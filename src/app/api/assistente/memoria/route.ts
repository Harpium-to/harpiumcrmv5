import { NextResponse } from 'next/server'

import { fail, resolve } from '@/lib/assistente/http'
import { isMissingTable } from '@/lib/assistente/store'
import { MEMORY_MAX } from '@/lib/assistente/tools/rotinas'

/** GET /api/assistente/memoria — what the team taught Harpi about this CRM. */
export async function GET() {
  try {
    const { ctx } = await resolve()
    const { data, error } = await ctx.db
      .from('assistant_memory')
      .select('id, content, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(MEMORY_MAX)
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ memory: [] })
      throw error
    }
    return NextResponse.json({ memory: data ?? [], canEdit: ctx.role !== 'viewer' && !ctx.readOnly })
  } catch (err) {
    return fail(err)
  }
}

/** POST /api/assistente/memoria  { content } (agent+) */
export async function POST(request: Request) {
  try {
    const { ctx } = await resolve()
    if (ctx.readOnly) return NextResponse.json({ error: 'Seu acesso é só de leitura.' }, { status: 403 })
    const body = (await request.json().catch(() => null)) as { content?: unknown } | null
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (content.length < 3 || content.length > 500) {
      return NextResponse.json({ error: 'Escreva de 3 a 500 caracteres.' }, { status: 400 })
    }
    const { count } = await ctx.admin
      .from('assistant_memory')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    if ((count ?? 0) >= MEMORY_MAX) {
      return NextResponse.json({ error: `A memória aceita até ${MEMORY_MAX} itens.` }, { status: 409 })
    }
    const { error } = await ctx.admin
      .from('assistant_memory')
      .insert({ account_id: ctx.accountId, content, created_by: ctx.userId })
    if (error) throw error
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return fail(err)
  }
}
