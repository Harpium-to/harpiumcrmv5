import type { SupabaseClient } from '@supabase/supabase-js'

import type { AiDispatchOutcome } from '@/lib/ai/auto-reply'

import {
  dispararIntegracoes,
  transferirConversa,
  type TransferSource,
  type TransferTarget,
} from './transferir'

// ============================================================
// When a customer writes: the return rule (before the AI) and the
// arrival rule (after it), plus the scheduler's tick for deadlines and
// setor queues. Migration 078; see docs/plano-distribuicao-atendimento.md
// §5.5–5.7.
//
// All of it is best-effort and never throws: a customer message must
// reach the inbox whatever happens here, and a database without 078
// simply behaves as before (nothing is distributed on arrival, a
// returning customer stays with whoever had them).
// ============================================================

export type ArrivalMode = 'fila_geral' | 'rodizio' | 'setor_entrada' | 'por_canal'
export type ReturnMode = 'mesma_pessoa' | 'ia' | 'distribuir'

export interface InboxSettings {
  arrivalMode: ArrivalMode
  /** channel → a setor id, 'rodizio' or 'fila'. */
  arrivalByChannel: Record<string, string>
  returnMode: ReturnMode
  returnDays: number
}

export const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  arrivalMode: 'fila_geral',
  arrivalByChannel: {},
  returnMode: 'mesma_pessoa',
  returnDays: 7,
}

const ARRIVAL_MODES: readonly ArrivalMode[] = ['fila_geral', 'rodizio', 'setor_entrada', 'por_canal']
const RETURN_MODES: readonly ReturnMode[] = ['mesma_pessoa', 'ia', 'distribuir']

/** A database row (or nothing) as settings, with the defaults filled in. */
export function parseInboxSettings(row: Record<string, unknown> | null | undefined): InboxSettings {
  if (!row) return { ...DEFAULT_INBOX_SETTINGS }
  const arrival = row.arrival_mode as ArrivalMode
  const ret = row.return_mode as ReturnMode
  const days = Number(row.return_days)
  const byChannel =
    row.arrival_by_channel && typeof row.arrival_by_channel === 'object' && !Array.isArray(row.arrival_by_channel)
      ? Object.fromEntries(
          Object.entries(row.arrival_by_channel as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
          ),
        )
      : {}
  return {
    arrivalMode: ARRIVAL_MODES.includes(arrival) ? arrival : DEFAULT_INBOX_SETTINGS.arrivalMode,
    arrivalByChannel: byChannel,
    returnMode: RETURN_MODES.includes(ret) ? ret : DEFAULT_INBOX_SETTINGS.returnMode,
    returnDays: Number.isFinite(days) && days >= 1 ? Math.min(365, Math.floor(days)) : DEFAULT_INBOX_SETTINGS.returnDays,
  }
}

export async function loadInboxSettings(db: SupabaseClient, accountId: string): Promise<InboxSettings> {
  const { data, error } = await db
    .from('inbox_settings')
    .select('arrival_mode, arrival_by_channel, return_mode, return_days')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) return { ...DEFAULT_INBOX_SETTINGS }
  return parseInboxSettings(data as Record<string, unknown> | null)
}

/**
 * Where a new message nobody answers goes, by the CRM's rule. Null:
 * the shared queue (nothing to do).
 */
export function arrivalTarget(
  settings: InboxSettings,
  channel: string,
  entryTeamId: string | null,
): TransferTarget | null {
  switch (settings.arrivalMode) {
    case 'fila_geral':
      return null
    case 'rodizio':
      return { kind: 'rodizio' }
    case 'setor_entrada':
      return entryTeamId ? { kind: 'setor', teamId: entryTeamId } : null
    case 'por_canal': {
      const rule = settings.arrivalByChannel[channel]
      if (!rule || rule === 'fila') return null
      if (rule === 'rodizio') return { kind: 'rodizio' }
      return { kind: 'setor', teamId: rule }
    }
  }
}

/** What to do with a customer writing to a closed conversation. */
export type ReturnDecision =
  /** Start over: nobody owns it, the AI answers if there is one. */
  | { kind: 'recomecar' }
  /** Stays with its owner, who is told and has it waiting. */
  | { kind: 'manter' }
  /** Goes to someone else (or to a queue). */
  | { kind: 'distribuir'; target: TransferTarget }
  /** Nothing to change. */
  | { kind: 'nada' }

/**
 * The return rule, pure:
 *   ia           — always start over;
 *   mesma_pessoa — the person they talked to in the last N days, when
 *                  available; that person unavailable → the setor or
 *                  the arrival rule (or, with neither, stay put and wait
 *                  for them); talked longer ago → start over;
 *   distribuir   — the setor or the arrival rule.
 */
export function decideReturn(args: {
  settings: InboxSettings
  ownerId: string | null
  ownerAvailable: boolean
  teamId: string | null
  lastHumanAt: Date | null
  now: Date
  /** The arrival rule's target for this channel, already resolved. */
  arrival: TransferTarget | null
}): ReturnDecision {
  const { settings, ownerId, ownerAvailable, teamId, lastHumanAt, now, arrival } = args
  const elsewhere: TransferTarget | null = teamId ? { kind: 'setor', teamId } : arrival

  if (settings.returnMode === 'ia') return { kind: 'recomecar' }

  if (settings.returnMode === 'mesma_pessoa') {
    const recent =
      lastHumanAt !== null && now.getTime() - lastHumanAt.getTime() <= settings.returnDays * 86_400_000
    if (!recent) return { kind: 'recomecar' }
    if (ownerId && ownerAvailable) return { kind: 'manter' }
    if (elsewhere) return { kind: 'distribuir', target: elsewhere }
    return ownerId ? { kind: 'manter' } : { kind: 'nada' }
  }

  // distribuir
  return elsewhere ? { kind: 'distribuir', target: elsewhere } : { kind: 'nada' }
}

export interface InboundArrival {
  accountId: string
  conversationId: string
}

interface ClaimedReturn {
  account_id: string
  contact_id: string
  assigned_agent_id: string | null
  team_id: string | null
  channel: string | null
  last_human_at: string | null
  owner_available: boolean
}

/**
 * Before the AI: a customer writing to a conversation that was closed.
 * Claimed once in the database (two messages arriving together apply
 * it once).
 */
export async function aplicarRetorno(db: SupabaseClient, a: InboundArrival): Promise<void> {
  try {
    const { data, error } = await db.rpc('claim_reopened', { p_conversation_id: a.conversationId })
    if (error || !Array.isArray(data) || data.length === 0) return
    const row = data[0] as ClaimedReturn

    const settings = await loadInboxSettings(db, a.accountId)
    const decision = decideReturn({
      settings,
      ownerId: row.assigned_agent_id,
      ownerAvailable: row.owner_available === true,
      teamId: row.team_id,
      lastHumanAt: row.last_human_at ? new Date(row.last_human_at) : null,
      now: new Date(),
      arrival: arrivalTarget(settings, row.channel ?? 'whatsapp', await entryTeamOf(db, a.accountId)),
    })
    const contact = await contactName(db, row.contact_id)

    switch (decision.kind) {
      case 'recomecar': {
        // As "Retomar IA": the bot (if any) answers, nobody owns it.
        await db
          .from('conversations')
          .update({ ai_autoreply_disabled: false, ai_reply_count: 0, ai_handoff_summary: null })
          .eq('id', a.conversationId)
        if (row.assigned_agent_id || row.team_id) {
          await transferirConversa(db, {
            conversationId: a.conversationId,
            target: { kind: 'ninguem', leaveTeam: true },
            source: 'retorno',
            note: `${contact} voltou depois de mais de ${settings.returnDays} dia(s): recomeça do zero`,
          })
        }
        return
      }
      case 'manter': {
        await markWaiting(db, a.conversationId, `↩️ ${contact} voltou a falar.`)
        if (row.assigned_agent_id) {
          await db.from('notifications').insert({
            account_id: a.accountId,
            user_id: row.assigned_agent_id,
            type: 'conversation_returned',
            conversation_id: a.conversationId,
            contact_id: row.contact_id,
            title: 'Voltou a falar',
            body: `${contact} voltou a falar com você`,
          })
        }
        return
      }
      case 'distribuir': {
        await transferirConversa(db, {
          conversationId: a.conversationId,
          target: decision.target,
          source: 'retorno',
          note: row.assigned_agent_id
            ? `${contact} voltou a falar e quem atendia não está disponível`
            : `${contact} voltou a falar`,
          waiting: true,
        })
        return
      }
      case 'nada':
        return
    }
  } catch (err) {
    console.error('[atendimento] return rule failed:', err)
  }
}

/**
 * After the AI: nobody is answering this message (no AI on the channel,
 * or no agent claims it) and nobody owns the conversation → the CRM's
 * arrival rule. A conversation already in a setor's queue is left
 * there (the scheduler hands it out).
 */
export async function aplicarChegada(
  db: SupabaseClient,
  a: InboundArrival & { aiOutcome: AiDispatchOutcome },
): Promise<void> {
  if (a.aiOutcome === 'engaged') return
  try {
    const { data: conv, error } = await db
      .from('conversations')
      .select('*')
      .eq('id', a.conversationId)
      .maybeSingle()
    if (error || !conv) return
    const row = conv as Record<string, unknown>
    if (row.status === 'closed' || row.assigned_agent_id || row.team_id) return

    const settings = await loadInboxSettings(db, a.accountId)
    if (settings.arrivalMode === 'fila_geral') return
    const channel = typeof row.channel === 'string' ? row.channel : 'whatsapp'
    const target = arrivalTarget(settings, channel, await entryTeamOf(db, a.accountId))
    if (!target) return

    await transferirConversa(db, {
      conversationId: a.conversationId,
      target,
      source: target.kind === 'rodizio' ? 'rodizio' : 'chegada',
      waiting: true,
      onlyIfUnassigned: true,
    })
  } catch (err) {
    console.error('[atendimento] arrival rule failed:', err)
  }
}

/**
 * The scheduler's tick (/api/automations/cron): deadlines and setor
 * queues, in the database, then the integrations for what moved.
 */
export async function processarAtendimento(db: SupabaseClient): Promise<{ alerted: number; moved: number }> {
  const { data, error } = await db.rpc('atendimento_tick', { p_limit: 200 })
  if (error) {
    // 078 not applied yet: nothing to do.
    return { alerted: 0, moved: 0 }
  }
  const r = (data ?? {}) as {
    alerted?: number
    moved?: Array<{
      conversation_id: string
      account_id: string
      contact_id: string | null
      from_user_id: string | null
      to_user_id: string | null
      team_id: string | null
      source: TransferSource
    }>
  }
  const moved = r.moved ?? []
  for (const m of moved) {
    await dispararIntegracoes({
      conversationId: m.conversation_id,
      accountId: m.account_id,
      contactId: m.contact_id,
      fromUserId: m.from_user_id,
      toUserId: m.to_user_id,
      teamId: m.team_id,
      source: m.source,
      note: null,
    })
  }
  return { alerted: r.alerted ?? 0, moved: moved.length }
}

// ------------------------------------------------------------

async function entryTeamOf(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db
    .from('teams')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_entry', true)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return (data as { id: string }).id
}

async function contactName(db: SupabaseClient, contactId: string | null): Promise<string> {
  if (!contactId) return 'O contato'
  const { data } = await db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
  const c = data as { name: string | null; phone: string | null } | null
  return c?.name?.trim() || c?.phone || 'O contato'
}

/**
 * Waiting for a person, without changing who owns it: pause the AI and
 * start the wait (058 keeps an explicit start while the AI is paused).
 */
async function markWaiting(db: SupabaseClient, conversationId: string, summary: string): Promise<void> {
  const { data } = await db
    .from('conversations')
    .select('needs_human_since')
    .eq('id', conversationId)
    .maybeSingle()
  const since = (data as { needs_human_since: string | null } | null)?.needs_human_since
  await db
    .from('conversations')
    .update({
      ai_autoreply_disabled: true,
      ai_handoff_summary: summary,
      needs_human_since: since ?? new Date().toISOString(),
    })
    .eq('id', conversationId)
}
