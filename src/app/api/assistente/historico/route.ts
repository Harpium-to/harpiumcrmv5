import { NextResponse } from 'next/server'

import { fail, resolve } from '@/lib/assistente/http'
import { isMissingTable } from '@/lib/assistente/store'

/**
 * GET /api/assistente/historico — what Harpi changed in this CRM.
 * Admins see everyone's actions (RLS); others, their own.
 */
export async function GET() {
  try {
    const { ctx } = await resolve()
    const { data, error } = await ctx.db
      .from('assistant_actions')
      .select('id, user_id, tool, risk, status, preview, result, error, auto, via_agency, created_at, executed_at, undone_at')
      .eq('account_id', ctx.accountId)
      .in('status', ['done', 'failed', 'undone'])
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ actions: [] })
      throw error
    }
    const people = [...new Set((data ?? []).map((a) => a.user_id as string).filter(Boolean))]
    const { data: profiles } = people.length
      ? await ctx.admin.from('profiles').select('user_id, full_name').in('user_id', people)
      : { data: [] }
    const names = new Map((profiles ?? []).map((p) => [p.user_id as string, p.full_name as string]))
    return NextResponse.json({
      actions: (data ?? []).map((a) => ({
        id: a.id,
        title: (a.preview as { title?: string } | null)?.title ?? a.tool,
        summary: (a.result as { summary?: string } | null)?.summary ?? null,
        status: a.status,
        risk: a.risk,
        auto: a.auto,
        viaAgency: a.via_agency,
        error: a.error,
        who: names.get(a.user_id as string) ?? null,
        at: a.executed_at ?? a.created_at,
      })),
    })
  } catch (err) {
    return fail(err)
  }
}
