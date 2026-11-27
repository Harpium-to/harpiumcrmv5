import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { emitTaskReminders } from '@/lib/tasks/reminders'
import { processScheduledMessages } from '@/lib/scheduled/messages'
import { processCalendarNotifications } from '@/lib/agenda/messages'
import { refreshGoogleBusy } from '@/lib/agenda/google-busy'
import { processGoogleCalendarSync } from '@/lib/agenda/google-sync'
import { resolvePublicOrigin } from '@/lib/http/base-url'
import { sweepQuizVisits } from '@/lib/quiz/sweep'
import { processRoutines } from '@/lib/assistente/routines'
import { processarAtendimento } from '@/lib/atendimento/chegada'
import { processarRadar } from '@/lib/radar'
import { processarAgentes } from '@/lib/agents/motor'

// Harpi's routines call the AI from here (one model call per step), so
// this tick may take longer than the bookkeeping above.
export const maxDuration = 60

/**
 * Time the routines may use, counted from the start of the request.
 * Kept under the 30 s an external pinger (cron-job.org) waits, so the
 * job never shows as failed; a run that needs more continues next tick.
 */
const ROUTINES_DEADLINE_MS = 25_000
/** The Radar's share of the tick (the rest is the routines'). */
const RADAR_BUDGET_MS = 8_000
/**
 * The AI agents' engine (rounds + work queue), counted from the start
 * of the request. Before the routines: agents talk to customers, the
 * routines only report to the team. What doesn't fit runs next tick.
 */
const AGENTS_DEADLINE_MS = 22_000

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 *
 * The same tick also sends the reminders of tasks that came due
 * (migration 060, src/lib/tasks/reminders.ts) and the messages
 * scheduled for contacts (migration 064, src/lib/scheduled/messages.ts),
 * and the agenda's confirmations and reminders (migration 067,
 * src/lib/agenda/messages.ts), and keeps the agenda and Google Agenda
 * in step both ways (migrations 069 and 071, src/lib/agenda/google-sync.ts
 * and google-busy.ts), and sends the quiz visits that left a contact
 * and stopped as partial leads (migration 072, src/lib/quiz/sweep.ts),
 * so they need no scheduler job of their own.
 * They run first and never throw: nothing about them can hold the
 * automations back.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'agendador não configurado' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const startedAt = Date.now()
  const admin = supabaseAdmin()
  const task_reminders = await emitTaskReminders(admin)
  const scheduled_messages = await processScheduledMessages(admin)
  const agenda_messages = await processCalendarNotifications(admin)
  const google_agenda = await processGoogleCalendarSync(admin, {
    crmUrl: resolvePublicOrigin(request, 'automations cron'),
  })
  // And what is in Google back into the CRM (071).
  const google_busy = await refreshGoogleBusy(admin)
  // Quiz visits that left a contact and stopped, and leads to retry (072).
  const quiz_visits = await sweepQuizVisits(admin)
  // Setor deadlines and queues (078): warn or pass on what is late,
  // hand queued conversations to whoever of the setor came online.
  const atendimento = await processarAtendimento(admin).catch((err) => {
    console.error('[cron] atendimento failed:', err)
    return { alerted: 0, moved: 0 }
  })
  // The Radar (079+): the daily ledger, anomalies, chances, the weekly
  // digest. Its own slice of the tick; what does not fit runs next time.
  const radar = await processarRadar(admin, { deadline: Date.now() + RADAR_BUDGET_MS }).catch((err) => {
    console.error('[cron] radar failed:', err)
    return null
  })

  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) {
    // The agents (082), then Harpi's routines last: nothing above waits on the AI (074).
    const agentes = await processarAgentes(admin, { deadline: startedAt + AGENTS_DEADLINE_MS })
    const routines = await processRoutines(admin, { deadline: startedAt + ROUTINES_DEADLINE_MS })
    return NextResponse.json({ processed: 0, task_reminders, scheduled_messages, agenda_messages, google_agenda, google_busy, quiz_visits, atendimento, radar, agentes, routines })
  }

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  const agentes = await processarAgentes(admin, { deadline: startedAt + AGENTS_DEADLINE_MS })
  const routines = await processRoutines(admin, { deadline: startedAt + ROUTINES_DEADLINE_MS })
  return NextResponse.json({ processed, task_reminders, scheduled_messages, agenda_messages, google_agenda, google_busy, quiz_visits, atendimento, radar, agentes, routines })
}
