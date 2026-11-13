// ============================================================
// Storing a visit to a quiz, and turning a finished one into a lead.
// Server only — called by POST /api/public/quiz/<slug> with the
// service-role client, after session.ts validated what was sent.
//
//   - Every update rewrites the visit's row: screens seen (never
//     losing one), answers so far, the contact read from them.
//   - The first update that says "done" closes the visit. The result is
//     worked out here from the stored answers, and closing is a single
//     conditional UPDATE, so two requests racing cannot both win: the
//     lead is delivered once.
//   - A closed visit is frozen. Later updates only count clicks on the
//     result screen's button.
//   - The lead goes through the CRM's own receiver (src/lib/leads), as
//     if it had arrived on the lead URL.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { dispatchLeadReceived } from '@/lib/leads/events'
import { ingestLead } from '@/lib/leads/ingest'
import { loadFieldMappings } from '@/lib/leads/mappings'
import { normalizeLead } from '@/lib/leads/parse'
import { contactFrom, evaluate, findStep, hasContactKey, type QuizOutcome } from './engine'
import { buildLeadPayload } from './lead'
import { lastStep, mergeSteps, type SessionUpdate } from './session'
import type { PublishedQuiz } from './store'
import { INTRO_STEP, type QuizAnswers } from './types'

export interface SessionRow {
  id: string
  account_id: string
  quiz_id: string
  sid: string
  seq: number
  steps: string[]
  last_step: string | null
  answers: QuizAnswers
  contact: Record<string, string>
  result_id: string | null
  route: 'A' | 'B' | 'C' | null
  tags: string[]
  utms: Record<string, string>
  device: 'mobile' | 'desktop' | null
  event_id: string | null
  meta: Record<string, unknown>
  started_at: string | null
  completed_at: string | null
  cta_clicks: number
  lead_id: string | null
  contact_id: string | null
  lead_status: string | null
  partial_sent_at: string | null
  created_at: string
  updated_at: string
}

export interface VisitContext {
  userAgent: string | null
  ip: string | null
  /** The address of the page the visitor is on. */
  pageUrl: string | null
}

export interface VisitOutcome {
  /** The visit is closed (now or before). */
  done: boolean
  resultId: string | null
  /** Work to run after the answer is sent: "lead recebido", Conversions API. */
  followUp: (() => Promise<void>) | null
}

const OPEN: VisitOutcome = { done: false, resultId: null, followUp: null }

/** Extra work a delivered lead triggers; set by the caller (capi.ts). */
export type AfterLead = (args: {
  quiz: PublishedQuiz
  session: SessionRow
  outcome: QuizOutcome
  context: VisitContext
}) => Promise<void>

export async function recordVisit(
  admin: SupabaseClient,
  quiz: PublishedQuiz,
  update: SessionUpdate,
  context: VisitContext,
  options: { now?: Date; afterLead?: AfterLead } = {},
): Promise<VisitOutcome> {
  // A robot filled the hidden field: answer as if all went well.
  if (update.trap) return OPEN
  const now = options.now ?? new Date()
  const def = quiz.definition

  const { data: prevData, error: prevErr } = await admin
    .from('quiz_sessions')
    .select('*')
    .eq('quiz_id', quiz.id)
    .eq('sid', update.sid)
    .maybeSingle()
  if (prevErr) throw new Error(prevErr.message)
  const prev = (prevData as SessionRow | null) ?? null

  if (prev?.completed_at) {
    if (update.cta) {
      const { error } = await admin
        .from('quiz_sessions')
        .update({ cta_clicks: (prev.cta_clicks ?? 0) + 1 })
        .eq('id', prev.id)
      if (error) console.error('[quiz] cta count failed:', error.message)
    }
    return { done: true, resultId: prev.result_id, followUp: null }
  }
  // An older update that arrived after a newer one.
  if (prev && update.seq < prev.seq) return OPEN

  const steps = mergeSteps(def, prev?.steps ?? [], update.steps)
  const contact = contactFrom(def, update.answers)
  const meta: Record<string, unknown> = { ...(prev?.meta ?? {}), ...update.meta }
  if (context.userAgent) meta.ua = context.userAgent.slice(0, 300)
  if (context.pageUrl) meta.url = context.pageUrl.slice(0, 500)
  if (update.consent && !meta.consent_at) meta.consent_at = now.toISOString()

  const row = {
    account_id: quiz.accountId,
    quiz_id: quiz.id,
    sid: update.sid,
    seq: update.seq,
    steps,
    last_step: lastStep(steps),
    answers: update.answers,
    contact,
    // The campaign is the one the visit arrived with.
    utms: prev && Object.keys(prev.utms ?? {}).length > 0 ? prev.utms : update.utms,
    device: update.device ?? prev?.device ?? null,
    event_id: update.eventId ?? prev?.event_id ?? null,
    meta,
    started_at:
      prev?.started_at ?? (steps.some((id) => id !== INTRO_STEP) ? now.toISOString() : null),
    updated_at: now.toISOString(),
  }

  const { data: saved, error: saveErr } = await admin
    .from('quiz_sessions')
    .upsert(row, { onConflict: 'quiz_id,sid' })
    .select('*')
    .single()
  if (saveErr) throw new Error(saveErr.message)
  const session = saved as SessionRow

  if (!update.done) return OPEN
  const outcome = evaluate(def, session.answers)
  if (!outcome) return OPEN

  const reachable = hasContactKey(contact)
  const { data: claimed, error: claimErr } = await admin
    .from('quiz_sessions')
    .update({
      completed_at: now.toISOString(),
      result_id: outcome.result.id,
      route: outcome.route,
      tags: outcome.tags,
      lead_status: reachable ? null : 'sem_contato',
    })
    .eq('id', session.id)
    .is('completed_at', null)
    .select('id')
  if (claimErr) throw new Error(claimErr.message)
  // Another request closed this visit first; it delivers the lead.
  if (!claimed || claimed.length === 0 || !reachable) {
    return { done: true, resultId: outcome.result.id, followUp: null }
  }

  const leadFollowUp = await deliverLead(admin, quiz, session, outcome)
  const afterLead = options.afterLead
  return {
    done: true,
    resultId: outcome.result.id,
    followUp: async () => {
      await leadFollowUp?.()
      await afterLead?.({ quiz, session, outcome, context }).catch((err) => {
        console.error('[quiz] after-lead step failed:', err)
      })
    },
  }
}

/**
 * Write a visit into the CRM as a lead. `outcome` null = a partial lead
 * (the visit left a contact and stopped). Never throws: a failure is
 * recorded on the visit ("erro") and tried again by the scheduler.
 * Returns the "lead recebido" dispatch, to run after the answer.
 */
export async function deliverLead(
  admin: SupabaseClient,
  quiz: PublishedQuiz,
  session: Pick<SessionRow, 'id' | 'sid' | 'answers' | 'utms' | 'meta' | 'last_step'>,
  outcome: QuizOutcome | null,
): Promise<(() => Promise<void>) | null> {
  try {
    const stopped = session.last_step ? findStep(quiz.definition, session.last_step)?.label : null
    const payload = buildLeadPayload(
      quiz.definition,
      {
        quizName: quiz.name,
        sid: session.sid,
        answers: session.answers,
        utms: session.utms ?? {},
        consentAt: typeof session.meta?.consent_at === 'string' ? session.meta.consent_at : null,
      },
      outcome,
      stopped,
    )
    const lead = normalizeLead(payload)

    const { data: account, error: accountErr } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', quiz.accountId)
      .maybeSingle()
    if (accountErr || !account) throw new Error(accountErr?.message ?? 'CRM não encontrado')

    const mappings = await loadFieldMappings(admin, quiz.accountId, lead.source)
    const result = await ingestLead(
      admin,
      { id: quiz.accountId, ownerUserId: account.owner_user_id },
      lead,
      payload,
      { mappings },
    )

    const { error: linkErr } = await admin
      .from('quiz_sessions')
      .update({
        lead_id: result.leadId,
        contact_id: result.contactId,
        lead_status: outcome ? 'ok' : 'parcial',
      })
      .eq('id', session.id)
    if (linkErr) console.error('[quiz] lead link failed:', linkErr.message)

    if (result.duplicate) return null
    return () =>
      dispatchLeadReceived(admin, {
        accountId: quiz.accountId,
        leadId: result.leadId,
        contactId: result.contactId,
        lead,
      })
  } catch (err) {
    console.error('[quiz] lead delivery failed:', err)
    const { error } = await admin
      .from('quiz_sessions')
      .update({ lead_status: 'erro' })
      .eq('id', session.id)
    if (error) console.error('[quiz] could not mark the failure:', error.message)
    return null
  }
}
