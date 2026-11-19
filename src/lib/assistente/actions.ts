import type { SupabaseClient } from '@supabase/supabase-js'

import { clip } from './format'
import { CARD_TTL_MS, UNDO_WINDOW_MS, decide } from './policy'
import { appendMessage, loadMessages } from './store'
import { toolByName } from './tools'
import { ACTION_COLUMNS, buildItems, type ActionRow } from './view'
import { ToolError, type Executed, type Preview, type Risk, type ToolContext, type UiItem } from './types'

// ============================================================
// The cards: create, confirm, cancel, undo.
//
// Confirming executes the input stored on the row — the one the card
// was built from — never a regenerated version. The `pending →
// running` UPDATE is the latch: two clicks, two tabs or a retry race
// on it and exactly one wins, so "Confirmar" means once.
//
// All writes to assistant_actions go through the service role (there
// is no client write policy); every query is scoped by the CRM and by
// the person the card belongs to.
// ============================================================

export async function createAction(
  ctx: ToolContext,
  args: {
    conversationId: string | null
    routineId?: string | null
    tool: string
    toolCallId: string | null
    input: Record<string, unknown>
    preview: Preview
    risk: Exclude<Risk, 'leitura'>
    status?: 'pending' | 'running'
    auto?: boolean
    /** How long the card stays valid (routines' cards wait longer). */
    ttlMs?: number
  },
): Promise<string> {
  const { data, error } = await ctx.admin
    .from('assistant_actions')
    .insert({
      account_id: ctx.accountId,
      conversation_id: args.conversationId,
      user_id: ctx.userId,
      routine_id: args.routineId ?? null,
      tool: args.tool,
      tool_call_id: args.toolCallId,
      input: args.input,
      preview: args.preview,
      risk: args.risk,
      status: args.status ?? 'pending',
      auto: args.auto === true,
      via_agency: ctx.viaAgency,
      expires_at:
        args.status === 'running' ? null : new Date(Date.now() + (args.ttlMs ?? CARD_TTL_MS)).toISOString(),
      ...(args.status === 'running' ? { decided_at: new Date().toISOString(), executed_at: new Date().toISOString() } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`não consegui registrar a ação: ${error?.message ?? ''}`)
  return (data as { id: string }).id
}

/** Run a tool's execute and record the outcome on the action row. */
export async function executeAndRecord(
  ctx: ToolContext,
  actionId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ ok: true; executed: Executed } | { ok: false; error: string }> {
  const tool = toolByName(toolName)
  if (!tool?.execute) {
    await finish(ctx, actionId, { status: 'failed', error: 'ferramenta desconhecida' })
    return { ok: false, error: 'ferramenta desconhecida' }
  }
  try {
    const executed = await tool.execute(ctx, input)
    await finish(ctx, actionId, {
      status: 'done',
      result: { summary: executed.summary, link: executed.link ?? null, ...(executed.result ?? {}) },
      undo: executed.undo ?? null,
    })
    await auditAgency(ctx, toolName)
    return { ok: true, executed }
  } catch (err) {
    const message =
      err instanceof ToolError ? err.message : err instanceof Error ? clip(err.message, 300) : 'erro ao executar'
    if (!(err instanceof ToolError)) console.error(`[assistente] ${toolName} failed:`, err)
    await finish(ctx, actionId, { status: 'failed', error: message })
    return { ok: false, error: message }
  }
}

async function finish(ctx: ToolContext, actionId: string, update: Record<string, unknown>): Promise<void> {
  await ctx.admin.from('assistant_actions').update(update).eq('id', actionId).eq('account_id', ctx.accountId)
}

/** The agency acting inside a client's CRM leaves a trace there too. */
async function auditAgency(ctx: ToolContext, toolName: string): Promise<void> {
  if (!ctx.viaAgency) return
  try {
    await ctx.admin.from('agencia_auditoria').insert({
      actor_user_id: ctx.userId,
      account_id: ctx.accountId,
      action: `assistente:${toolName}`,
    })
  } catch {
    // Never let the audit trail break the action itself.
  }
}

async function loadOwnAction(ctx: ToolContext, actionId: string): Promise<ActionRow & { input: Record<string, unknown>; conversation_id: string | null; user_id: string | null }> {
  const { data } = await ctx.admin
    .from('assistant_actions')
    .select(`${ACTION_COLUMNS}, input, conversation_id, user_id`)
    .eq('id', actionId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  const row = data as (ActionRow & { input: Record<string, unknown>; conversation_id: string | null; user_id: string | null }) | null
  if (!row || row.user_id !== ctx.userId) throw new ToolError('Esse cartão não é seu ou não existe mais.')
  return row
}

async function tellModel(ctx: ToolContext, conversationId: string | null, text: string): Promise<void> {
  if (!conversationId) return
  await appendMessage(ctx.admin, {
    conversationId,
    accountId: ctx.accountId,
    role: 'event',
    content: { text },
  })
}

export type Decided =
  | { outcome: 'done'; summary: string; conversationId: string | null }
  | { outcome: 'failed'; error: string; conversationId: string | null }
  | { outcome: 'expired' | 'cancelled' | 'already'; conversationId: string | null }

export async function confirmAction(
  ctx: ToolContext,
  actionId: string,
  settings: { smallChanges: boolean },
): Promise<Decided> {
  const row = await loadOwnAction(ctx, actionId)
  if (row.status !== 'pending') return { outcome: 'already', conversationId: row.conversation_id }

  const title = String((row.preview as { title?: string } | null)?.title ?? row.tool)
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    await ctx.admin.from('assistant_actions').update({ status: 'expired' }).eq('id', actionId).eq('status', 'pending')
    await tellModel(ctx, row.conversation_id, `O cartão "${title}" expirou sem resposta; nada foi feito.`)
    return { outcome: 'expired', conversationId: row.conversation_id }
  }

  // The person's role may have changed since the card was made.
  const tool = toolByName(row.tool)
  if (!tool) throw new ToolError('Ferramenta desconhecida.')
  const decision = decide({
    tool,
    risk: row.risk as Risk,
    role: ctx.role,
    readOnly: ctx.readOnly,
    smallChangesUnasked: settings.smallChanges,
    unattended: false,
  })
  if (decision.kind === 'deny') throw new ToolError(`Não dá: ${decision.reason}.`)

  const now = new Date().toISOString()
  const { data: claimed } = await ctx.admin
    .from('assistant_actions')
    .update({ status: 'running', decided_at: now, executed_at: now })
    .eq('id', actionId)
    .eq('account_id', ctx.accountId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claimed) return { outcome: 'already', conversationId: row.conversation_id }

  const result = await executeAndRecord(ctx, actionId, row.tool, row.input ?? {})
  if (result.ok) {
    await tellModel(
      ctx,
      row.conversation_id,
      `A pessoa CONFIRMOU o cartão "${title}". Resultado: ${result.executed.summary}${
        result.executed.result ? ` Dados: ${JSON.stringify(result.executed.result)}` : ''
      }`,
    )
    return { outcome: 'done', summary: result.executed.summary, conversationId: row.conversation_id }
  }
  await tellModel(ctx, row.conversation_id, `A pessoa confirmou o cartão "${title}", mas deu erro: ${result.error}`)
  return { outcome: 'failed', error: result.error, conversationId: row.conversation_id }
}

export async function cancelAction(
  ctx: ToolContext,
  actionId: string,
  reason: 'cancelar' | 'ajustar',
): Promise<Decided> {
  const row = await loadOwnAction(ctx, actionId)
  if (row.status !== 'pending') return { outcome: 'already', conversationId: row.conversation_id }
  const { data } = await ctx.admin
    .from('assistant_actions')
    .update({ status: 'cancelled', decided_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!data) return { outcome: 'already', conversationId: row.conversation_id }
  const title = String((row.preview as { title?: string } | null)?.title ?? row.tool)
  await tellModel(
    ctx,
    row.conversation_id,
    reason === 'ajustar'
      ? `A pessoa quer AJUSTAR o cartão "${title}" antes (ele foi descartado; nada foi feito). Espere ela dizer o que mudar.`
      : `A pessoa CANCELOU o cartão "${title}". Nada foi feito; não proponha de novo.`,
  )
  return { outcome: 'cancelled', conversationId: row.conversation_id }
}

export async function undoAction(ctx: ToolContext, actionId: string): Promise<{ summary: string }> {
  const row = await loadOwnAction(ctx, actionId)
  const tool = toolByName(row.tool)
  if (row.status !== 'done' || !row.undo || !tool?.undo) throw new ToolError('Isso não dá para desfazer.')
  const executedAt = row.executed_at ? new Date(row.executed_at).getTime() : 0
  if (Date.now() - executedAt > UNDO_WINDOW_MS) throw new ToolError('Passou o prazo para desfazer (24 horas).')
  // Latch first, so a double click undoes once.
  const { data: claimed } = await ctx.admin
    .from('assistant_actions')
    .update({ status: 'undone', undone_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('status', 'done')
    .select('id')
    .maybeSingle()
  if (!claimed) throw new ToolError('Já foi desfeito.')
  try {
    await tool.undo(ctx, row.undo)
  } catch (err) {
    await ctx.admin.from('assistant_actions').update({ status: 'done', undone_at: null }).eq('id', actionId)
    throw err instanceof ToolError ? err : new ToolError('Não consegui desfazer.')
  }
  const title = String((row.preview as { title?: string } | null)?.title ?? row.tool)
  await tellModel(ctx, row.conversation_id, `A pessoa DESFEZ "${title}". Está como antes.`)
  return { summary: 'Desfeito.' }
}

/** Expire stale cards of a conversation (shown as expired anyway). */
export async function expireStale(admin: SupabaseClient, conversationId: string): Promise<void> {
  await admin
    .from('assistant_actions')
    .update({ status: 'expired' })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
}

/** Pending, unexpired cards in a conversation. */
export async function pendingCount(admin: SupabaseClient, conversationId: string): Promise<number> {
  const { count } = await admin
    .from('assistant_actions')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
  return count ?? 0
}

/** Everything the panel shows for one conversation. */
export async function loadView(ctx: ToolContext, conversationId: string): Promise<UiItem[]> {
  const messages = await loadMessages(ctx.db, conversationId, 150)
  const since = messages[0]?.created_at ?? new Date(0).toISOString()
  const { data } = await ctx.db
    .from('assistant_actions')
    .select(ACTION_COLUMNS)
    .eq('conversation_id', conversationId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(200)
  return buildItems(messages, (data ?? []) as ActionRow[])
}
