import type { SupabaseClient } from '@supabase/supabase-js'

import { isAccountRole, type AccountRole } from '@/lib/auth/roles'

import { pendingCount } from './actions'
import { clip, safeZone } from './format'
import { runStep } from './loop'
import { checkReadiness } from './session'
import { appendMessage, createConversation, isMissingTable, loadMessages } from './store'
import { nextRunAt } from './time'
import type { StoredBlock, ToolContext } from './types'

// ============================================================
// The routines' worker, called from /api/automations/cron (no cron of
// its own to register).
//
// A run is a conversation turn like any other, driven here instead of
// by the panel: one model call per step, as many steps per tick as
// the time budget allows, and the rest on the next tick (the run's
// state is the conversation itself). When it ends, the owner gets a
// notification with the result and how many changes wait for an OK.
//
// It never throws: the automations cron must not stop because of it.
// ============================================================

type Row = Record<string, unknown>

export interface RoutineSummary {
  started: number
  advanced: number
  finished: number
  failed: number
}

const RUN_STALE_MS = 2 * 3_600_000
const RETENTION_DAYS = 90
/** Leave this much of the budget untouched for the response. */
const SAFETY_MS = 5_000

export async function processRoutines(
  admin: SupabaseClient,
  opts: { deadline: number; now?: () => number },
): Promise<RoutineSummary | { skipped: string }> {
  const summary: RoutineSummary = { started: 0, advanced: 0, finished: 0, failed: 0 }
  const now = opts.now ?? (() => Date.now())
  try {
    const probe = await admin.from('assistant_routines').select('id').limit(1)
    if (probe.error) {
      return { skipped: isMissingTable(probe.error) ? 'migration 074 não aplicada' : probe.error.message }
    }

    await housekeeping(admin)

    // 1. Runs already under way.
    const { data: running } = await admin
      .from('assistant_routine_runs')
      .select('id, routine_id, account_id, conversation_id, steps, started_at')
      .eq('status', 'running')
      .order('started_at', { ascending: true })
      .limit(5)
    for (const run of (running ?? []) as Row[]) {
      if (now() + SAFETY_MS * 3 > opts.deadline) break
      if (now() - new Date(String(run.started_at)).getTime() > RUN_STALE_MS) {
        await finishRun(admin, run, 'failed', 'A rotina demorou demais e foi interrompida.')
        summary.failed++
        continue
      }
      const outcome = await advance(admin, run, opts.deadline, now)
      if (outcome === 'advanced') summary.advanced++
      if (outcome === 'finished') summary.finished++
      if (outcome === 'failed') summary.failed++
    }

    // 2. Routines that came due.
    const { data: due } = await admin
      .from('assistant_routines')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_at', new Date(now()).toISOString())
      .order('next_run_at', { ascending: true })
      .limit(3)
    for (const routine of (due ?? []) as Row[]) {
      if (now() + SAFETY_MS * 3 > opts.deadline) break
      const run = await start(admin, routine, now)
      if (!run) continue
      summary.started++
      const outcome = await advance(admin, run, opts.deadline, now)
      if (outcome === 'finished') summary.finished++
      if (outcome === 'failed') summary.failed++
    }
  } catch (err) {
    console.error('[assistente routines] tick failed:', err)
  }
  return summary
}

/** Expire old cards and forget old conversations (LGPD retention). */
async function housekeeping(admin: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString()
  await admin.from('assistant_actions').update({ status: 'expired' }).eq('status', 'pending').lt('expires_at', nowIso)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
  await admin.from('assistant_conversations').delete().lt('updated_at', cutoff)
}

/** The routine owner's role in the CRM, or null when they left it. */
async function ownerRole(admin: SupabaseClient, accountId: string, userId: string): Promise<AccountRole | null> {
  const { data: account } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if ((account as Row | null)?.owner_user_id === userId) return 'owner'
  const { data: member } = await admin
    .from('account_members')
    .select('role')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  const role = (member as Row | null)?.role
  return isAccountRole(role) ? role : null
}

async function contextForRoutine(
  admin: SupabaseClient,
  routine: Row,
): Promise<ToolContext | { error: string }> {
  const accountId = String(routine.account_id)
  const userId = String(routine.user_id)
  const role = await ownerRole(admin, accountId, userId)
  if (!role) return { error: 'quem criou a rotina não está mais neste CRM' }
  const [{ data: account }, { data: profile }] = await Promise.all([
    admin.from('accounts').select('status').eq('id', accountId).maybeSingle(),
    admin.from('profiles').select('full_name').eq('user_id', userId).maybeSingle(),
  ])
  return {
    // No session here: the service role, with every tool scoped by the
    // CRM (each query filters by account_id), as the cron's other jobs.
    db: admin,
    admin,
    accountId,
    userId,
    userName: String((profile as Row | null)?.full_name ?? ''),
    role,
    viaAgency: false,
    readOnly: role === 'viewer' || (account as Row | null)?.status === 'suspended',
    timezone: safeZone(String(routine.timezone ?? '')),
    now: new Date(),
  }
}

async function start(admin: SupabaseClient, routine: Row, now: () => number): Promise<Row | null> {
  // Claim: move next_run_at forward only if nobody else did.
  const next = nextRunAt(
    (routine.weekdays ?? []) as number[],
    String(routine.run_time),
    String(routine.timezone),
    new Date(now() + 60_000),
  )
  const { data: claimed } = await admin
    .from('assistant_routines')
    .update({ next_run_at: next?.toISOString() ?? null, last_run_at: new Date(now()).toISOString() })
    .eq('id', String(routine.id))
    .eq('next_run_at', String(routine.next_run_at))
    .select('id')
    .maybeSingle()
  if (!claimed) return null

  const ctx = await contextForRoutine(admin, routine)
  if ('error' in ctx) {
    await admin.from('assistant_routines').update({ is_active: false }).eq('id', String(routine.id))
    return null
  }
  const ready = await checkReadiness(admin, ctx.accountId)
  if (!ready.ready) {
    await notify(admin, routine, `Rotina "${routine.name}" não rodou`, ready.message)
    return null
  }

  let conversationId = routine.conversation_id ? String(routine.conversation_id) : null
  if (conversationId) {
    const { data: conv } = await admin.from('assistant_conversations').select('id').eq('id', conversationId).maybeSingle()
    if (!conv) conversationId = null
  }
  if (!conversationId) {
    conversationId = await createConversation(admin, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      title: `Rotina: ${clip(String(routine.name), 50)}`,
      origin: 'routine',
    })
    await admin.from('assistant_routines').update({ conversation_id: conversationId }).eq('id', String(routine.id))
  }

  await appendMessage(admin, {
    conversationId,
    accountId: ctx.accountId,
    role: 'user',
    content: {
      text: `[Rotina "${routine.name}", rodando sozinha agora] ${routine.instruction}`,
      routine: routine.name,
    },
  })
  const { data: run } = await admin
    .from('assistant_routine_runs')
    .insert({
      routine_id: routine.id,
      account_id: ctx.accountId,
      conversation_id: conversationId,
      status: 'running',
    })
    .select('id, routine_id, account_id, conversation_id, steps, started_at')
    .single()
  return (run as Row | null) ?? null
}

type Advance = 'advanced' | 'finished' | 'failed' | 'idle'

async function advance(admin: SupabaseClient, run: Row, deadline: number, now: () => number): Promise<Advance> {
  const { data: routine } = await admin.from('assistant_routines').select('*').eq('id', String(run.routine_id)).maybeSingle()
  if (!routine) {
    await finishRun(admin, run, 'failed', 'A rotina foi apagada.')
    return 'failed'
  }
  const ctx = await contextForRoutine(admin, routine as Row)
  if ('error' in ctx) {
    await finishRun(admin, run, 'failed', ctx.error)
    return 'failed'
  }
  const ready = await checkReadiness(admin, ctx.accountId)
  if (!ready.ready) {
    await finishRun(admin, run, 'failed', ready.message)
    return 'failed'
  }

  let steps = Number(run.steps) || 0
  let moved = false
  for (;;) {
    const remaining = deadline - now() - SAFETY_MS
    if (remaining < 10_000) return moved ? 'advanced' : 'idle'
    const result = await runStep({
      ctx: { ...ctx, now: new Date() },
      ai: ready.ai,
      model: ready.model,
      settings: ready.settings,
      conversationId: String(run.conversation_id),
      routine: { id: String((routine as Row).id), name: String((routine as Row).name) },
      timeoutMs: Math.min(remaining, 40_000),
    })
    steps++
    moved = true
    await admin.from('assistant_routine_runs').update({ steps }).eq('id', String(run.id))
    if (result.status === 'continue') continue
    if (result.status === 'error' && (result.code === 'timeout' || result.code === 'rate_limited')) {
      // Out of time or throttled: try again on the next tick.
      return moved ? 'advanced' : 'idle'
    }
    if (result.status === 'error') {
      await finishRun(admin, run, 'failed', result.error ?? 'erro da IA', routine as Row)
      return 'failed'
    }
    await finishRun(admin, run, 'done', null, routine as Row)
    return 'finished'
  }
}

async function finishRun(
  admin: SupabaseClient,
  run: Row,
  status: 'done' | 'failed',
  error: string | null,
  routine?: Row,
): Promise<void> {
  const conversationId = run.conversation_id ? String(run.conversation_id) : null
  let summary = ''
  if (conversationId) {
    const messages = await loadMessages(admin, conversationId, 6).catch(() => [])
    const lastText = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && ((m.content?.blocks ?? []) as StoredBlock[]).some((b) => b.type === 'text'))
    if (lastText) {
      summary = ((lastText.content.blocks ?? []) as StoredBlock[])
        .filter((b): b is Extract<StoredBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
    }
  }
  await admin
    .from('assistant_routine_runs')
    .update({ status, error, summary: clip(summary, 2000) || null, finished_at: new Date().toISOString() })
    .eq('id', String(run.id))

  if (!routine) return
  const waiting = conversationId ? await pendingCount(admin, conversationId) : 0
  const body =
    status === 'failed'
      ? `Não deu certo: ${error ?? 'erro'}`
      : `${clip(summary.replace(/[*_#`[\]]/g, ''), 240) || 'Pronto.'}${
          waiting ? ` · ${waiting} alteração(ões) esperando seu OK no Harpi.` : ''
        }`
  await notify(admin, routine, `Rotina: ${clip(String(routine.name), 60)}`, body)
}

async function notify(admin: SupabaseClient, routine: Row, title: string, body: string): Promise<void> {
  const { error } = await admin.from('notifications').insert({
    account_id: routine.account_id,
    user_id: routine.user_id,
    type: 'assistente',
    title,
    body,
  })
  if (error) console.error('[assistente routines] notification failed:', error)
}
