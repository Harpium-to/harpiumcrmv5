import { after, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { mapApprovalRow } from '@/lib/agents/approvals'
import { resumeTask } from '@/lib/agents/tasks'
import { processGoogleCalendarSync } from '@/lib/agenda/google-sync'
import { processCalendarNotifications } from '@/lib/agenda/messages'
import { supabaseAdmin } from '@/lib/automations/admin-client'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PATCH /api/agents/approvals/:id  (agent+)
 *
 * Approve, edit-and-approve, or reject a parked action.
 *
 * Runs under the operator's own session rather than the service role,
 * so `decided_by` is genuinely who clicked. That is the difference
 * between an audit trail and a log.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`approvals:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const decision =
      body && typeof body === 'object' && typeof body.decision === 'string'
        ? body.decision
        : ''
    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json(
        { error: 'a decisão precisa ser "approve" ou "reject"' },
        { status: 400 },
      )
    }

    const note =
      body && typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null
    const edited =
      body &&
      body.edited_payload &&
      typeof body.edited_payload === 'object' &&
      !Array.isArray(body.edited_payload)
        ? (body.edited_payload as Record<string, unknown>)
        : null

    const { data, error } = await supabase
      .from('agent_approvals')
      .update({
        status: decision === 'approve' ? 'approved' : 'rejected',
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
        // Only set on approve: an edit attached to a rejection would
        // be a change nobody asked for and nothing will ever read.
        edited_payload: decision === 'approve' ? edited : null,
      })
      .eq('id', id)
      .eq('account_id', accountId)
      // Only a pending row is decidable. Without this filter a double
      // click would overwrite the first decision (and its author) with
      // the second.
      .eq('status', 'pending')
      .select(
        'id, agent_id, agent_name_snapshot, task_id, contact_id, kind, summary, payload, edited_payload, status, decided_by, decided_at, decision_note, expires_at, executed_at, created_at',
      )
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: 'Aprovação não encontrada ou já decidida' },
        { status: 409 },
      )
    }

    const approval = mapApprovalRow(data)

    // Release or kill the task that was waiting on this. Written after
    // the decision on purpose — see the header of lib/agents/approvals.ts.
    if (approval.taskId) {
      if (decision === 'approve') {
        await resumeTask(supabase, approval.taskId)
      } else {
        await supabase
          .from('agent_tasks')
          .update({
            status: 'cancelled',
            last_error: 'rejeitado na aprovação',
            finished_at: new Date().toISOString(),
          })
          .eq('id', approval.taskId)
          .eq('account_id', accountId)
      }
    }

    // An appointment an AI agent reserved (lib/agenda/ai.ts) has no
    // task: the appointment itself is what waits, as 'pending'.
    // Approving books it, refusing frees the slot. Only while it is
    // still pending — settled on the agenda meanwhile, there is
    // nothing left to do. Under the operator's session, so RLS decides
    // whether they may (agents and above).
    const eventId = String(approval.payload.event_id ?? '')
    if (approval.kind === 'schedule_meeting' && !approval.taskId && UUID.test(eventId)) {
      const { data: flipped, error: eventError } = await supabase
        .from('calendar_events')
        .update({ status: decision === 'approve' ? 'scheduled' : 'cancelled' })
        .eq('id', eventId)
        .eq('account_id', accountId)
        .eq('status', 'pending')
        .select('id')
      if (eventError) throw eventError
      await supabase
        .from('agent_approvals')
        .update({ executed_at: new Date().toISOString() })
        .eq('id', approval.id)
        .eq('account_id', accountId)
      // The customer was told the team would confirm: do it now rather
      // than at the scheduler's next run (which remains the safety net).
      if (decision === 'approve' && (flipped ?? []).length > 0) {
        await processCalendarNotifications(supabaseAdmin(), eventId)
      }
      // Approved or refused, Google Agenda follows (069).
      if ((flipped ?? []).length > 0) {
        const { origin } = new URL(request.url)
        after(() => processGoogleCalendarSync(supabaseAdmin(), { eventId, crmUrl: origin }))
      }
    }

    return NextResponse.json({ approval })
  } catch (err) {
    return toErrorResponse(err)
  }
}
