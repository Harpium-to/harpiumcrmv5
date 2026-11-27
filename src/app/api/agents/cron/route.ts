import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processarAgentes } from '@/lib/agents/motor'

/**
 * Drive the agent work queue.
 *
 * Without this endpoint the queue is inert: tasks accumulate and
 * nothing claims them. `claim_agent_task` makes concurrent hits safe
 * (FOR UPDATE SKIP LOCKED), so overlapping cron runs degrade into
 * doing less work each rather than doing the same work twice.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET`, like the flows and
 * automations sweeps, so operators provision one secret rather than
 * three.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / an
 * external pinger). Every minute suits an outbound operation; every
 * five is fine for a quieter one. Each hit is bounded — accounts and
 * tasks per account are both capped below — so the cost of a tick is
 * predictable regardless of backlog.
 */
export const maxDuration = 60


export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'agendador não configurado' }, { status: 503 })
  }
  // Constant-time compare so an attacker who can reach the endpoint
  // can't recover the secret from response-time deltas. The length
  // pre-check is required by timingSafeEqual and leaks only the
  // length, which isn't sensitive.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Same engine as /api/automations/cron (082): the pulse, stale
  // approvals, the rounds and the queue. This endpoint stays for
  // installs that already call it, with a longer budget.
  const summary = await processarAgentes(supabaseAdmin(), { deadline: Date.now() + 50_000 })
  return NextResponse.json(summary)
}
