// ============================================================
// What the scheduler does for quizzes, once a minute (it rides on
// /api/automations/cron, like the task reminders and the agenda):
//
//   1. Partial leads. A visit that left a phone or an e-mail and then
//      stopped is sent to the CRM as a lead tagged "quiz-incompleto" —
//      only for quizzes that turned this on (quizzes.partial_lead), and
//      only after 30 quiet minutes, so someone still answering is not
//      called in the middle of the quiz. If the person comes back and
//      finishes, the finished lead arrives as usual.
//   2. Retries. A finished visit whose lead failed to be written
//      ("erro") is tried again, for a day.
//
// Each visit is claimed with a conditional UPDATE before anything is
// sent, so two overlapping runs never deliver the same one twice.
// Never throws: nothing here may hold back the automations that share
// the schedule.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/leads/mappings'
import { evaluate, hasContactKey } from './engine'
import type { PublishedQuiz } from './store'
import { deliverLead, type SessionRow } from './submit'
import { sanitizeDefinition } from './validate'

/** Quiet time before a visit counts as abandoned. */
export const PARTIAL_AFTER_MS = 30 * 60_000
/** Visits older than this are left alone. */
export const SWEEP_WINDOW_MS = 24 * 60 * 60_000
const BATCH = 50

interface QuizForSweep {
  id: string
  account_id: string
  name: string
  slug: string
  published: unknown
}

function asPublished(row: QuizForSweep): PublishedQuiz | null {
  if (row.published == null) return null
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    slug: row.slug,
    definition: sanitizeDefinition(row.published),
  }
}

export interface SweepResult {
  partial: number
  retried: number
}

export async function sweepQuizVisits(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<SweepResult | null> {
  try {
    const partial = await sendPartialLeads(admin, now)
    const retried = await retryFailedLeads(admin, now)
    return { partial, retried }
  } catch (err) {
    console.error('[quiz sweep] failed:', err)
    return null
  }
}

async function sendPartialLeads(admin: SupabaseClient, now: Date): Promise<number> {
  const { data: quizRows, error: quizErr } = await admin
    .from('quizzes')
    .select('id, account_id, name, slug, published')
    .eq('partial_lead', true)
  if (quizErr) {
    if (!isMissingTable(quizErr)) console.error('[quiz sweep] quizzes read failed:', quizErr.message)
    return 0
  }
  const quizzes = new Map<string, PublishedQuiz>()
  for (const row of (quizRows ?? []) as QuizForSweep[]) {
    const quiz = asPublished(row)
    if (quiz?.definition.settings.partialLead) quizzes.set(quiz.id, quiz)
  }
  if (quizzes.size === 0) return 0

  const { data: rows, error } = await admin
    .from('quiz_sessions')
    .select('*')
    .in('quiz_id', [...quizzes.keys()])
    .is('completed_at', null)
    .is('partial_sent_at', null)
    .lt('updated_at', new Date(now.getTime() - PARTIAL_AFTER_MS).toISOString())
    .gte('updated_at', new Date(now.getTime() - SWEEP_WINDOW_MS).toISOString())
    .order('updated_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    console.error('[quiz sweep] visits read failed:', error.message)
    return 0
  }

  let sent = 0
  for (const session of (rows ?? []) as SessionRow[]) {
    const quiz = quizzes.get(session.quiz_id)
    if (!quiz) continue
    // Claimed either way: a visit with no contact is never looked at again.
    const { data: claimed } = await admin
      .from('quiz_sessions')
      .update({ partial_sent_at: now.toISOString() })
      .eq('id', session.id)
      .is('partial_sent_at', null)
      .is('completed_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) continue
    if (!hasContactKey(session.contact ?? {})) continue

    const followUp = await deliverLead(admin, quiz, session, null)
    if (followUp) await followUp().catch((err) => console.error('[quiz sweep] dispatch failed:', err))
    sent += 1
  }
  return sent
}

async function retryFailedLeads(admin: SupabaseClient, now: Date): Promise<number> {
  const { data: rows, error } = await admin
    .from('quiz_sessions')
    .select('*')
    .eq('lead_status', 'erro')
    .gte('updated_at', new Date(now.getTime() - SWEEP_WINDOW_MS).toISOString())
    .limit(20)
  if (error) {
    if (!isMissingTable(error)) console.error('[quiz sweep] retries read failed:', error.message)
    return 0
  }
  const sessions = (rows ?? []) as SessionRow[]
  if (sessions.length === 0) return 0

  const { data: quizRows } = await admin
    .from('quizzes')
    .select('id, account_id, name, slug, published')
    .in('id', [...new Set(sessions.map((s) => s.quiz_id))])
  const quizzes = new Map<string, PublishedQuiz>()
  for (const row of (quizRows ?? []) as QuizForSweep[]) {
    const quiz = asPublished(row)
    if (quiz) quizzes.set(quiz.id, quiz)
  }

  let retried = 0
  for (const session of sessions) {
    const quiz = quizzes.get(session.quiz_id)
    if (!quiz) continue
    // Taken out of "erro" first, so an overlapping run skips it.
    const { data: claimed } = await admin
      .from('quiz_sessions')
      .update({ lead_status: null })
      .eq('id', session.id)
      .eq('lead_status', 'erro')
      .select('id')
    if (!claimed || claimed.length === 0) continue

    // A finished visit keeps its result; a partial one has none.
    const outcome = session.completed_at ? evaluate(quiz.definition, session.answers) : null
    const followUp = await deliverLead(admin, quiz, session, outcome)
    if (followUp) await followUp().catch((err) => console.error('[quiz sweep] dispatch failed:', err))
    retried += 1
  }
  return retried
}
