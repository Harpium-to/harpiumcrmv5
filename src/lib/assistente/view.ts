import { UNDO_WINDOW_MS } from './policy'
import { toolByName } from './tools'
import type { Preview, Risk, StoredBlock, StoredMessage, StoredToolResult, UiAction, UiItem } from './types'

// ============================================================
// Stored conversation + actions → what the panel draws. Pure.
// ============================================================

export interface ActionRow {
  id: string
  tool: string
  tool_call_id: string | null
  risk: string
  status: string
  preview: Record<string, unknown> | null
  result: Record<string, unknown> | null
  undo: Record<string, unknown> | null
  error: string | null
  auto: boolean
  expires_at: string | null
  executed_at: string | null
  created_at: string
}

export const ACTION_COLUMNS =
  'id, tool, tool_call_id, risk, status, preview, result, undo, error, auto, expires_at, executed_at, created_at'

export function toUiAction(row: ActionRow, now = new Date()): UiAction {
  const result = (row.result ?? {}) as Record<string, unknown>
  const link = result.link as { href?: string; label?: string } | undefined
  const expired =
    row.status === 'pending' && !!row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()
  const executedAt = row.executed_at ? new Date(row.executed_at).getTime() : 0
  return {
    id: row.id,
    tool: row.tool,
    risk: (row.risk as Exclude<Risk, 'leitura'>) ?? 'maior',
    status: expired ? 'expired' : (row.status as UiAction['status']),
    preview: (row.preview ?? { title: row.tool, lines: [] }) as unknown as Preview,
    summary: typeof result.summary === 'string' ? result.summary : null,
    error: row.error,
    link: link?.href ? { href: String(link.href), label: String(link.label ?? 'Abrir') } : null,
    canUndo:
      row.status === 'done' &&
      !!row.undo &&
      !!toolByName(row.tool)?.undo &&
      now.getTime() - executedAt < UNDO_WINDOW_MS,
    auto: row.auto === true,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

export function buildItems(messages: StoredMessage[], actions: ActionRow[], now = new Date()): UiItem[] {
  const items: UiItem[] = []
  const actionByCall = new Map(actions.filter((a) => a.tool_call_id).map((a) => [a.tool_call_id as string, a]))
  const shown = new Set<string>()

  // Which calls failed, to mark their activity line.
  const failed = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'tool') continue
    for (const r of ((m.content?.results ?? []) as StoredToolResult[])) {
      if (r.isError) failed.add(r.id)
    }
  }

  for (const m of messages) {
    const c = m.content ?? {}
    if (m.role === 'user') {
      if (c.routine) {
        items.push({ kind: 'notice', id: m.id, text: `Rotina: ${String(c.routine)}`, at: m.created_at })
      } else {
        items.push({ kind: 'user', id: m.id, text: String(c.text ?? ''), at: m.created_at })
      }
    } else if (m.role === 'assistant') {
      const blocks = (Array.isArray(c.blocks) ? c.blocks : []) as StoredBlock[]
      const text = blocks
        .filter((b): b is Extract<StoredBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n')
        .trim()
      if (text) items.push({ kind: 'assistant', id: m.id, text, at: m.created_at })
      for (const b of blocks) {
        if (b.type !== 'tool_call') continue
        const action = actionByCall.get(b.id)
        if (action) {
          shown.add(action.id)
          items.push({ kind: 'action', id: `a:${action.id}`, action: toUiAction(action, now), at: action.created_at })
        } else {
          const tool = toolByName(b.name)
          items.push({
            kind: 'activity',
            id: `t:${b.id}`,
            label: tool?.label ?? b.name,
            failed: failed.has(b.id),
            at: m.created_at,
          })
        }
      }
    }
  }

  // Actions whose message fell out of the window (or routines' cards).
  for (const a of actions) {
    if (!shown.has(a.id)) {
      items.push({ kind: 'action', id: `a:${a.id}`, action: toUiAction(a, now), at: a.created_at })
    }
  }
  return items
}
