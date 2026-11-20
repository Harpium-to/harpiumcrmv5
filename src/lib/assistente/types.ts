import type { SupabaseClient } from '@supabase/supabase-js'

import type { JsonSchema } from '@/lib/ai/tool-chat'
import type { AccountRole } from '@/lib/auth/roles'

// ============================================================
// Harpi — shared types.
//
// A TOOL is one thing the assistant can do, as the CRM's own screens
// do it. Two kinds:
//   read   — `run` answers on the spot;
//   write  — `prepare` turns the input into a confirmation card, and
//            `execute` does it, later, after a person clicked. The
//            model never decides whether a write may run: `risk` and
//            `minRole`, written here in code, do (policy.ts).
// ============================================================

/**
 *   leitura  read only, runs at once
 *   pequena  small and reversible (a note, a tag on one contact)
 *   maior    several records, or something that runs by itself later
 *   cliente  a customer sees it (a message, an automation that sends)
 */
export type Risk = 'leitura' | 'pequena' | 'maior' | 'cliente'

export interface ToolContext {
  /** RLS-scoped client of the person — the same access as their screens. */
  db: SupabaseClient
  /** Service role, only where the matching screen's route uses it too. */
  admin: SupabaseClient
  accountId: string
  userId: string
  userName: string
  role: AccountRole
  viaAgency: boolean
  /** Viewer, read-only agency consent, or a suspended CRM. */
  readOnly: boolean
  /** IANA zone the person is in (the CRM has no zone of its own). */
  timezone: string
  now: Date
}

/** What a confirmation card shows. Built by code from the exact input. */
export interface Preview {
  title: string
  /** One line each; rendered as a list. */
  lines: string[]
  /** Short labels: "Fala com clientes", "23 contatos", "Nasce desligada". */
  badges?: string[]
  warnings?: string[]
  /** Records affected, when it is a batch. */
  count?: number
  /** A few names from the batch, to see who is in it. */
  sample?: string[]
  /** Offered as a second button ("Criar e abrir no editor"). */
  openAfter?: { label: string }
}

export interface Prepared {
  preview: Preview
  /** The input as it will run: ids resolved, defaults filled. */
  input: Record<string, unknown>
  /** Overrides the tool's static risk (e.g. an automation that sends). */
  risk?: Exclude<Risk, 'leitura'>
}

export interface Executed {
  /** One sentence for the person and the model: what happened. */
  summary: string
  result?: Record<string, unknown>
  /** Where to see it. */
  link?: { href: string; label: string }
  /** Data `undo` needs; omit when it cannot be undone. */
  undo?: Record<string, unknown>
}

export interface ToolDef {
  name: string
  /** Activity line in the panel: "Procurou contatos". */
  label: string
  description: string
  parameters: JsonSchema
  risk: Risk
  minRole: AccountRole
  /** read tools */
  run?: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>
  /** write tools */
  prepare?: (ctx: ToolContext, input: Record<string, unknown>) => Promise<Prepared | { error: string }>
  execute?: (ctx: ToolContext, input: Record<string, unknown>) => Promise<Executed>
  undo?: (ctx: ToolContext, data: Record<string, unknown>) => Promise<void>
}

/** Thrown inside tools for a problem the model (and person) should read. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

// ------------------------------------------------------------
// Stored messages (assistant_messages.content)
// ------------------------------------------------------------

export type StoredBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }

export interface StoredToolResult {
  id: string
  name: string
  content: string
  isError?: boolean
  actionId?: string
}

export type StoredContent =
  | { text: string; page?: string }
  | { blocks: StoredBlock[] }
  | { results: StoredToolResult[] }

export interface StoredMessage {
  id: string
  seq: number
  role: 'user' | 'assistant' | 'tool' | 'event'
  content: Record<string, unknown>
  created_at: string
}

// ------------------------------------------------------------
// What the panel renders
// ------------------------------------------------------------

export type ActionStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'undone'

export interface UiAction {
  id: string
  tool: string
  risk: Exclude<Risk, 'leitura'>
  status: ActionStatus
  preview: Preview
  summary: string | null
  error: string | null
  link: { href: string; label: string } | null
  canUndo: boolean
  auto: boolean
  expiresAt: string | null
  createdAt: string
}

export type UiItem =
  | { kind: 'user'; id: string; text: string; at: string }
  | { kind: 'assistant'; id: string; text: string; at: string }
  | { kind: 'activity'; id: string; label: string; failed: boolean; at: string }
  | { kind: 'action'; id: string; action: UiAction; at: string }
  | { kind: 'notice'; id: string; text: string; at: string }

export type StepStatus = 'continue' | 'done' | 'needs_confirmation' | 'limit' | 'error'

export interface StepOutcome {
  status: StepStatus
  conversationId: string
  items: UiItem[]
  error?: string
}
