import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/automations/admin-client'

// ============================================================
// The one way to give a conversation to someone.
//
// Every path that changes who owns a conversation — the inbox's
// "Transferir" and "Assumir", the AI handing off, flows, automations,
// Harpi, the public API and the scheduler — goes through
// `transferirConversa`. It calls `transfer_conversation()` (migration
// 076), which in one transaction picks the person (rotation), writes
// the owner, and lets the database triggers record the history and
// notify whoever received it. Then, outside the transaction, it fires
// what the rest of the system listens to: the "Conversa atribuída"
// automations and the `conversation.assigned` webhook.
//
// The database client decides who is acting: a person's RLS-scoped
// client makes `auth.uid()` that person (and the function only accepts
// 'manual' or 'harpi' from them); the service role speaks for the AI,
// flows, automations and jobs, naming the actor in `actorUserId`.
// See docs/plano-distribuicao-atendimento.md §5.1.
// ============================================================

/** Where a transfer came from. Mirrors the CHECK on conversation_transfers.source. */
export type TransferSource =
  | 'manual'
  | 'ia'
  | 'rodizio'
  | 'fluxo'
  | 'automacao'
  | 'harpi'
  | 'api'
  | 'prazo'
  | 'retorno'
  | 'chegada'

export type TransferTarget =
  /** A specific person of this CRM (never a viewer). */
  | { kind: 'pessoa'; userId: string }
  /** The CRM-wide rotation: online first, whoever received longest ago. */
  | { kind: 'rodizio' }
  /** A setor: its own distribution rule decides who (077). */
  | { kind: 'setor'; teamId: string }
  /**
   * Nobody: back to the queue of the conversation's setor (or the shared
   * queue). `leaveTeam` takes it out of the setor too — "Retomar IA",
   * where the bot owns it and no human queue should show it (077).
   */
  | { kind: 'ninguem'; leaveTeam?: boolean }

export interface TransferInput {
  conversationId: string
  target: TransferTarget
  source: TransferSource
  /** Shown in the conversation's history and in the notification. Max 500 chars. */
  note?: string | null
  /** Who did it, when the client is the service role. Ignored for a person's client. */
  actorUserId?: string | null
  /** "Pegar": change nothing when someone already owns it. */
  onlyIfUnassigned?: boolean
  /** Also mark it as waiting for a person: pause the AI, start the wait. */
  waiting?: boolean
  /**
   * Fire the "Conversa atribuída" automations and the webhook after a
   * change. Default true. The automation engine passes false while it
   * runs a "Conversa atribuída" automation, so an automation that
   * assigns cannot set itself off again in a loop.
   */
  fireIntegrations?: boolean
}

export type TransferReason =
  | 'not_found'
  | 'already_assigned'
  | 'nobody_available'
  | 'not_migrated'

export interface TransferResult {
  ok: boolean
  /** The owner actually changed (a no-op transfer to the same person is ok but not changed). */
  changed: boolean
  reason?: TransferReason
  fromUserId: string | null
  toUserId: string | null
  /** The setor the conversation is in after the transfer (077). */
  teamId: string | null
  accountId: string | null
  contactId: string | null
}

/** A refusal the person can read: not allowed, not a teammate, bad input. */
export class TransferError extends Error {
  constructor(
    message: string,
    /** 403 for permission, 400 for input, 500 otherwise. */
    public readonly status: number,
  ) {
    super(message)
    this.name = 'TransferError'
  }
}

interface RpcResult {
  ok?: boolean
  changed?: boolean
  reason?: string
  from_user_id?: string | null
  to_user_id?: string | null
  team_id?: string | null
  account_id?: string | null
  contact_id?: string | null
}

const NOTE_MAX = 500

/** Trim a note to what the database keeps; empty becomes null. */
export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim()
  if (!trimmed) return null
  return trimmed.length > NOTE_MAX ? trimmed.slice(0, NOTE_MAX) : trimmed
}

/** PostgREST / Postgres codes for "this function does not exist yet". */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function/i.test(error.message ?? '')
  )
}

function modeOf(target: TransferTarget): string {
  return target.kind
}

export async function transferirConversa(
  db: SupabaseClient,
  input: TransferInput,
): Promise<TransferResult> {
  const note = cleanNote(input.note)
  const args: Record<string, unknown> = {
    p_conversation_id: input.conversationId,
    p_mode: modeOf(input.target),
    p_to_user_id: input.target.kind === 'pessoa' ? input.target.userId : null,
    p_source: input.source,
    p_note: note,
    p_actor_user_id: input.actorUserId ?? null,
    p_only_if_unassigned: input.onlyIfUnassigned === true,
    p_waiting: input.waiting === true,
  }
  // Only sent when used, so a database still on 076 (no p_team_id,
  // no p_leave_team) keeps answering every other kind of transfer.
  if (input.target.kind === 'setor') args.p_team_id = input.target.teamId
  if (input.target.kind === 'ninguem' && input.target.leaveTeam) args.p_leave_team = true

  const { data, error } = await db.rpc('transfer_conversation', args)

  if (error) {
    // A database without 076, or a 076 one asked for 077's leaveTeam:
    // the old direct write. A setor cannot exist before 077, so there
    // is nothing to fall back to for one.
    if (isMissingFunction(error) && input.target.kind !== 'setor') {
      return legacyTransfer(db, input)
    }
    if (error.code === '42501') throw new TransferError(error.message, 403)
    if (error.code === '22023' || error.code === '22P02') {
      throw new TransferError(error.message, 400)
    }
    throw new TransferError(error.message || 'Falha ao transferir a conversa', 500)
  }

  const r = (data ?? {}) as RpcResult
  const result: TransferResult = {
    ok: r.ok === true,
    changed: r.changed === true,
    reason: (r.reason as TransferReason | undefined) ?? undefined,
    fromUserId: r.from_user_id ?? null,
    toUserId: r.to_user_id ?? null,
    teamId: r.team_id ?? null,
    accountId: r.account_id ?? null,
    contactId: r.contact_id ?? null,
  }

  if (result.ok && result.changed && input.fireIntegrations !== false && result.accountId) {
    await dispararIntegracoes({
      conversationId: input.conversationId,
      accountId: result.accountId,
      contactId: result.contactId,
      fromUserId: result.fromUserId,
      toUserId: result.toUserId,
      teamId: result.teamId,
      source: input.source,
      note,
    })
  }
  return result
}

/** An owner change, as the rest of the system hears about it. */
export interface AssignmentEvent {
  conversationId: string
  accountId: string
  contactId: string | null
  fromUserId: string | null
  toUserId: string | null
  teamId: string | null
  source: TransferSource
  note: string | null
}

/**
 * What the rest of the system hears about an assignment: the
 * "Conversa atribuída" automations (when someone received it) and the
 * `conversation.assigned` webhook. Exported for the scheduler, whose
 * moves happen inside the database (atendimento_tick, 078). Never
 * throws: the conversation already changed hands, and a webhook
 * endpoint being down must not turn that into an error.
 */
export async function dispararIntegracoes(ev: AssignmentEvent): Promise<void> {
  const admin = supabaseAdmin()

  if (ev.toUserId) {
    try {
      // Imported here, not at the top: the engine itself calls
      // transferirConversa for its "Atribuir conversa" step.
      const { runAutomationsForTrigger } = await import('@/lib/automations/engine')
      await runAutomationsForTrigger({
        accountId: ev.accountId,
        triggerType: 'conversation_assigned',
        contactId: ev.contactId,
        context: {
          conversation_id: ev.conversationId,
          agent_id: ev.toUserId,
        },
      })
    } catch (err) {
      console.error('[atendimento] conversation_assigned automations failed:', err)
    }
  }

  try {
    const { dispatchWebhookEvent } = await import('@/lib/webhooks/deliver')
    await dispatchWebhookEvent(admin, ev.accountId, 'conversation.assigned', {
      conversation_id: ev.conversationId,
      contact_id: ev.contactId,
      from_user_id: ev.fromUserId,
      to_user_id: ev.toUserId,
      team_id: ev.teamId,
      source: ev.source,
      note: ev.note,
    })
  } catch (err) {
    console.error('[atendimento] conversation.assigned webhook failed:', err)
  }
}

/**
 * Before migration 076 is applied: the old direct write, so nothing
 * breaks in the window between deploying the code and running the SQL.
 * No history, no rotation (the first teammate found), no note.
 */
async function legacyTransfer(
  db: SupabaseClient,
  input: TransferInput,
): Promise<TransferResult> {
  const { data: conv } = await db
    .from('conversations')
    .select('account_id, contact_id, assigned_agent_id')
    .eq('id', input.conversationId)
    .maybeSingle()
  const row = conv as { account_id: string; contact_id: string; assigned_agent_id: string | null } | null
  const base = {
    teamId: null,
    accountId: row?.account_id ?? null,
    contactId: row?.contact_id ?? null,
  }
  if (!row) {
    return { ok: false, changed: false, reason: 'not_found', fromUserId: null, toUserId: null, ...base }
  }
  if (input.onlyIfUnassigned && row.assigned_agent_id) {
    return {
      ok: false,
      changed: false,
      reason: 'already_assigned',
      fromUserId: row.assigned_agent_id,
      toUserId: row.assigned_agent_id,
      ...base,
    }
  }

  let target: string | null = null
  if (input.target.kind === 'pessoa') target = input.target.userId
  if (input.target.kind === 'rodizio') {
    const { data: members } = await db
      .from('account_members')
      .select('user_id, role')
      .eq('account_id', row.account_id)
      .neq('role', 'viewer')
      .order('created_at', { ascending: true })
      .limit(1)
    target = (members?.[0] as { user_id: string } | undefined)?.user_id ?? null
    if (!target) {
      return {
        ok: false,
        changed: false,
        reason: 'nobody_available',
        fromUserId: row.assigned_agent_id,
        toUserId: row.assigned_agent_id,
        ...base,
      }
    }
  }

  const update: Record<string, unknown> = { assigned_agent_id: target }
  if (input.waiting) update.ai_autoreply_disabled = true
  const { error } = await db.from('conversations').update(update).eq('id', input.conversationId)
  if (error) throw new TransferError(error.message, 500)

  return {
    ok: true,
    changed: target !== row.assigned_agent_id,
    reason: 'not_migrated',
    fromUserId: row.assigned_agent_id,
    toUserId: target,
    ...base,
  }
}
