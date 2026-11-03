import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { runAccountQueue, type QueueSummary } from '@/lib/agents/runner'

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

/** Accounts touched per tick. */
const MAX_ACCOUNTS = 20
/** Tasks drained per account per tick. */
const MAX_TASKS_PER_ACCOUNT = 5

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()

  // Expire stale approvals before running anything. A reply approved
  // tomorrow is worse than no reply, and leaving them pending would
  // keep their tasks parked forever.
  const { error: expireErr } = await db
    .from('agent_approvals')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())
  if (expireErr) {
    console.error('[agents-cron] expiring approvals failed:', expireErr.message)
  }

  // Only accounts that actually have runnable work. Scanning every
  // account on the instance to find the three with a queue is the kind
  // of thing that is free at ten tenants and a problem at ten thousand.
  const { data: pending, error } = await db
    .from('agent_tasks')
    .select('account_id')
    .in('status', ['queued', 'blocked'])
    .lte('scheduled_for', new Date().toISOString())
    .limit(500)

  if (error) {
    console.error('[agents-cron] queue scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const accountIds = [
    ...new Set((pending ?? []).map((row) => (row as { account_id: string }).account_id)),
  ].slice(0, MAX_ACCOUNTS)

  if (accountIds.length === 0) {
    return NextResponse.json({ accounts: 0, claimed: 0 })
  }

  const totals: QueueSummary = {
    claimed: 0,
    completed: 0,
    deferred: 0,
    parked: 0,
    failed: 0,
  }

  // Sequential on purpose. Each account's tasks hit the same provider
  // key, and fanning out would turn one busy tenant into a rate-limit
  // incident for every other one sharing this process.
  for (const accountId of accountIds) {
    try {
      const summary = await runAccountQueue(accountId, MAX_TASKS_PER_ACCOUNT)
      totals.claimed += summary.claimed
      totals.completed += summary.completed
      totals.deferred += summary.deferred
      totals.parked += summary.parked
      totals.failed += summary.failed
    } catch (err) {
      // One tenant's broken configuration must not stop the sweep.
      console.error(`[agents-cron] account ${accountId} failed:`, err)
    }
  }

  return NextResponse.json({ accounts: accountIds.length, ...totals })
}
