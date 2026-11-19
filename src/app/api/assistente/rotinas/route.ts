import { NextResponse } from 'next/server'

import { fail, resolve } from '@/lib/assistente/http'
import { isMissingTable } from '@/lib/assistente/store'
import { describeSchedule } from '@/lib/assistente/time'

/** GET /api/assistente/rotinas — own routines (admins: the whole team's). */
export async function GET() {
  try {
    const { ctx } = await resolve()
    const { data, error } = await ctx.db
      .from('assistant_routines')
      .select('id, user_id, name, instruction, weekdays, run_time, timezone, is_active, next_run_at, last_run_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(100)
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ routines: [] })
      throw error
    }
    const owners = [...new Set((data ?? []).map((r) => r.user_id as string))]
    const { data: profiles } = owners.length
      ? await ctx.admin.from('profiles').select('user_id, full_name').in('user_id', owners)
      : { data: [] }
    const names = new Map((profiles ?? []).map((p) => [p.user_id as string, p.full_name as string]))
    return NextResponse.json({
      routines: (data ?? []).map((r) => ({
        ...r,
        schedule: describeSchedule((r.weekdays ?? []) as number[], String(r.run_time)),
        owner: names.get(r.user_id as string) ?? null,
        mine: r.user_id === ctx.userId,
      })),
    })
  } catch (err) {
    return fail(err)
  }
}
