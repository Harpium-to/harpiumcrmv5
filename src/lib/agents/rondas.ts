import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { contactOptedOut } from '@/lib/contacts/opt-out'

import { proactiveLimitReached } from './limites'
import { findCandidates, type Candidate } from './rondas-checks'
import { isRondaKind, rondaPreset } from './rondas-catalogo'
import { coolDownBucket, nextRondaRun } from './rondas-tempo'
import { isWithinWorkingHours, nextWorkingSlot } from './schedule'
import { enqueueTask } from './tasks'

// ============================================================
// The rounds' scheduler — Fase 2 of docs/plano-agentes-ativos.md.
//
// Called by the agent engine (motor.ts) on every tick. For each round
// that is due: off shift → wait for the shift; on shift → run its query
// (rondas-checks.ts), drop the cases the limits rule out, and hand the
// rest to the agent as tasks of kind 'ronda'. The agent then works each
// case with its tools (loop.ts). A round that finds nothing ends there,
// silently and without calling the AI.
//
// Never throws: the cron that runs it must not stop because of it.
// ============================================================

type Row = Record<string, unknown>

export interface RondasSummary {
  ran: number
  found: number
  queued: number
}

/** Why a case was left alone, counted per round run. */
type SkipReason = 'opt_out' | 'ocupado' | 'limite' | 'nunca_conversou' | 'repetido'

async function hasInbound(db: SupabaseClient, accountId: string, contactId: string): Promise<boolean> {
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  const ids = ((convs ?? []) as Row[]).map((c) => String(c.id))
  if (ids.length === 0) return false
  const { data } = await db.from('messages').select('id').in('conversation_id', ids).eq('sender_type', 'customer').limit(1)
  return (data ?? []).length > 0
}

async function cameAsLead(db: SupabaseClient, accountId: string, contactId: string): Promise<boolean> {
  const { data } = await db.from('leads').select('id').eq('account_id', accountId).eq('contact_id', contactId).limit(1)
  return (data ?? []).length > 0
}

async function skipReason(
  db: SupabaseClient,
  args: { accountId: string; agentId: string; c: Candidate; now: Date; unofficial: boolean },
): Promise<SkipReason | null> {
  const { accountId, agentId, c, now } = args
  if (await contactOptedOut(db, accountId, c.contactId)) return 'opt_out'
  // Already on this agent's desk.
  const { data: open } = await db
    .from('agent_tasks')
    .select('id')
    .eq('agent_id', agentId)
    .eq('contact_id', c.contactId)
    .in('status', ['queued', 'blocked', 'running', 'waiting_approval'])
    .limit(1)
  if ((open ?? []).length > 0) return 'ocupado'
  const { data: sends } = await db
    .from('agent_proactive_sends')
    .select('sent_at')
    .eq('account_id', accountId)
    .eq('contact_id', c.contactId)
    .gte('sent_at', new Date(now.getTime() - 7 * 86_400_000).toISOString())
  if (proactiveLimitReached(((sends ?? []) as Row[]).map((s) => String(s.sent_at)), now)) return 'limite'
  // On the unofficial WhatsApp, an unprompted message only to people
  // who talked to the business — or asked for contact by leaving their
  // details as a lead. Cold messages are what gets a number banned.
  if (args.unofficial && !(await hasInbound(db, accountId, c.contactId)) && !(await cameAsLead(db, accountId, c.contactId))) {
    return 'nunca_conversou'
  }
  return null
}

export async function processarRondas(
  db: SupabaseClient,
  opts: { deadline: number; now?: Date },
): Promise<RondasSummary> {
  const now = opts.now ?? new Date()
  const summary: RondasSummary = { ran: 0, found: 0, queued: 0 }

  let rondas: Row[] = []
  try {
    const { data, error } = await db
      .from('agent_rondas')
      .select(
        'id, account_id, agent_id, name, check_kind, params, instruction, every_minutes, run_at, run_days, max_per_run, send_needs_approval, agent:agents(id, name, is_active, work_days, work_start, work_end, timezone)',
      )
      .eq('is_active', true)
      .lte('next_run_at', now.toISOString())
      .order('next_run_at', { ascending: true })
      .limit(20)
    if (error) throw error
    rondas = (data ?? []) as Row[]
  } catch (err) {
    // 082 not applied yet, or a read error: no rounds this tick.
    console.error('[rondas] could not read the rounds:', err)
    return summary
  }

  const providerByAccount = new Map<string, string | null>()

  for (const r of rondas) {
    if (Date.now() > opts.deadline) break
    const id = String(r.id)
    const accountId = String(r.account_id)
    const agent = r.agent as Row | null
    const tz = String(agent?.timezone ?? 'America/Sao_Paulo')
    const schedule = {
      everyMinutes: (r.every_minutes as number | null) ?? null,
      runAt: (r.run_at as string | null) ?? null,
      runDays: ((r.run_days as number[] | null) ?? [1, 2, 3, 4, 5]).map(Number),
    }
    try {
      if (!agent || agent.is_active !== true) {
        // A switched-off agent doesn't do rounds; look again in an hour.
        await db.from('agent_rondas').update({ next_run_at: new Date(now.getTime() + 3_600_000).toISOString() }).eq('id', id)
        continue
      }
      const shift = {
        workDays: ((agent.work_days as number[] | null) ?? []).map(Number),
        workStart: String(agent.work_start ?? '09:00'),
        workEnd: String(agent.work_end ?? '18:00'),
        timezone: tz,
      }
      if (!isWithinWorkingHours(shift, now)) {
        const slot = nextWorkingSlot(shift, now) ?? new Date(now.getTime() + 3_600_000)
        // A daily round keeps its own time; an "every N minutes" one
        // starts with the shift.
        const next = schedule.everyMinutes ? slot : nextRondaRun(schedule, tz, now)
        await db.from('agent_rondas').update({ next_run_at: next.toISOString() }).eq('id', id)
        continue
      }

      const kind = String(r.check_kind)
      if (!isRondaKind(kind)) continue
      const preset = rondaPreset(kind)
      const candidates = await findCandidates(db, {
        accountId,
        kind,
        params: (r.params as Record<string, unknown>) ?? {},
        now,
        timezone: tz,
      })

      if (!providerByAccount.has(accountId)) {
        providerByAccount.set(accountId, await resolveWhatsAppProvider(db, accountId).catch(() => null))
      }
      const unofficial = providerByAccount.get(accountId) !== 'meta'

      const max = Math.min(Math.max(Number(r.max_per_run) || 5, 1), 20)
      const skipped: Partial<Record<SkipReason, number>> = {}
      let queued = 0
      const bucket = coolDownBucket(now, preset?.coolDownDays ?? 1)
      for (const c of candidates) {
        if (queued >= max || Date.now() > opts.deadline) break
        const reason = await skipReason(db, { accountId, agentId: String(agent.id), c, now, unofficial })
        if (reason) {
          skipped[reason] = (skipped[reason] ?? 0) + 1
          continue
        }
        const task = await enqueueTask(db, {
          accountId,
          agentId: String(agent.id),
          kind: 'ronda',
          title: `${String(r.name)}: ${c.label}`.slice(0, 200),
          input: {
            ronda_id: id,
            ronda_nome: String(r.name),
            instrucao: String(r.instruction ?? '') || preset?.instruction || '',
            situacao: c.situacao,
            envio_precisa_ok: r.send_needs_approval !== false,
          },
          contactId: c.contactId,
          conversationId: c.conversationId,
          dealId: c.dealId,
          priority: 10,
          dedupeKey: `ronda:${id}:${c.contactId}:${bucket}`,
        })
        if (task) queued += 1
        else skipped.repetido = (skipped.repetido ?? 0) + 1
      }

      const note =
        candidates.length === 0
          ? 'Nada para fazer.'
          : `${candidates.length} caso(s) encontrado(s), ${queued} passado(s) ao agente.`
      await db.from('agent_ronda_runs').insert({
        account_id: accountId,
        ronda_id: id,
        agent_id: String(agent.id),
        found: candidates.length,
        queued,
        skipped,
        note,
      })
      await db
        .from('agent_rondas')
        .update({
          last_run_at: now.toISOString(),
          last_found: candidates.length,
          last_note: note,
          next_run_at: nextRondaRun(schedule, tz, now).toISOString(),
        })
        .eq('id', id)
      summary.ran += 1
      summary.found += candidates.length
      summary.queued += queued
    } catch (err) {
      console.error(`[rondas] round ${id} failed:`, err)
      // Try again later rather than every tick.
      await db
        .from('agent_rondas')
        .update({
          last_run_at: now.toISOString(),
          last_note: `Falhou: ${err instanceof Error ? err.message.slice(0, 200) : 'erro'}`,
          next_run_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
        })
        .eq('id', id)
    }
  }
  return summary
}
