import { NextResponse } from 'next/server'

import { fail, resolve } from '@/lib/assistente/http'
import { isMissingTable } from '@/lib/assistente/store'

/** GET /api/assistente/conversas — the person's own conversations, newest first. */
export async function GET() {
  try {
    const { ctx } = await resolve()
    const { data, error } = await ctx.db
      .from('assistant_conversations')
      .select('id, title, origin, updated_at')
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .order('updated_at', { ascending: false })
      .limit(30)
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ conversations: [] })
      throw error
    }
    return NextResponse.json({ conversations: data ?? [] })
  } catch (err) {
    return fail(err)
  }
}
