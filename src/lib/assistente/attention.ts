import type { ToolContext } from './types'

// ============================================================
// Phase 4 — what the face's badge counts: things that need a person.
// Cheap head-counts only; the panel polls this every minute or so.
// ============================================================

export interface AttentionItem {
  kind: 'cartoes' | 'esperando' | 'automacoes' | 'aprovacoes'
  count: number
  label: string
  /** What to ask Harpi when the person taps it. */
  prompt: string
}

export async function loadAttention(ctx: ToolContext): Promise<AttentionItem[]> {
  const dayAgo = new Date(ctx.now.getTime() - 86_400_000).toISOString()
  const head = { count: 'exact' as const, head: true }
  const [cards, waiting, failing, approvals] = await Promise.all([
    ctx.db
      .from('assistant_actions')
      .select('id', head)
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
      .eq('status', 'pending')
      .gt('expires_at', ctx.now.toISOString()),
    ctx.db
      .from('conversations')
      .select('id', head)
      .eq('account_id', ctx.accountId)
      .not('needs_human_since', 'is', null),
    ctx.db
      .from('automation_logs')
      .select('id', head)
      .eq('account_id', ctx.accountId)
      .eq('status', 'failed')
      .gte('created_at', dayAgo),
    ctx.db
      .from('agent_approvals')
      .select('id', head)
      .eq('account_id', ctx.accountId)
      .eq('status', 'pending'),
  ])

  const items: AttentionItem[] = []
  if (cards.count) {
    items.push({
      kind: 'cartoes',
      count: cards.count,
      label: `${cards.count} alteração(ões) esperando seu OK`,
      prompt: 'O que está esperando o meu OK?',
    })
  }
  if (waiting.count) {
    items.push({
      kind: 'esperando',
      count: waiting.count,
      label: `${waiting.count} conversa(s) esperando atendente`,
      prompt: 'Quais conversas estão esperando atendente? Comece pelas mais antigas.',
    })
  }
  if (failing.count) {
    items.push({
      kind: 'automacoes',
      count: failing.count,
      label: `${failing.count} falha(s) de automação nas últimas 24h`,
      prompt: 'Quais automações falharam nas últimas 24 horas e por quê?',
    })
  }
  if (approvals.count) {
    items.push({
      kind: 'aprovacoes',
      count: approvals.count,
      label: `${approvals.count} aprovação(ões) de agentes paradas`,
      prompt: 'O que os agentes de IA estão esperando aprovação?',
    })
  }
  return items
}
