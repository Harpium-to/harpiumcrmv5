import { hasMinRole, type AccountRole } from '@/lib/auth/roles'

import type { Risk, ToolDef } from './types'

// ============================================================
// May the assistant do this, and does a person have to click first?
//
// Pure and in code, like lib/agents/autonomy.ts: the model is never
// asked whether it may do something. Three outcomes:
//
//   run      read tools — answer now
//   auto     a small, reversible change in a CRM that allows those
//            to run unasked (with Undo) — run now, record it
//   confirm  everything else that changes something — a card
//   deny     the person's role (or a read-only CRM) does not allow it
//
// 'cliente' and 'maior' ALWAYS confirm, whatever the CRM chose. Only
// 'pequena' can ever skip the card, and only when the CRM turned that
// on and the action is for a person in the panel (routines never).
// ============================================================

export type Decision =
  | { kind: 'run' }
  | { kind: 'auto' }
  | { kind: 'confirm' }
  | { kind: 'deny'; reason: string }

export interface PolicyInput {
  tool: Pick<ToolDef, 'name' | 'minRole' | 'risk'>
  /** The risk `prepare` settled on (a batch, an automation that sends). */
  risk: Risk
  role: AccountRole
  readOnly: boolean
  smallChangesUnasked: boolean
  /** A routine runs unattended: nothing it proposes runs by itself. */
  unattended: boolean
}

export function decide(p: PolicyInput): Decision {
  if (p.risk === 'leitura') return { kind: 'run' }
  if (p.readOnly) {
    return { kind: 'deny', reason: 'quem pergunta só tem acesso de leitura neste CRM' }
  }
  if (!hasMinRole(p.role, p.tool.minRole)) {
    const need = { owner: 'dono', admin: 'administrador', agent: 'atendente', viewer: 'leitor' }[p.tool.minRole]
    return { kind: 'deny', reason: `isso precisa do papel ${need} ou acima` }
  }
  if (p.risk === 'pequena' && p.smallChangesUnasked && !p.unattended) return { kind: 'auto' }
  return { kind: 'confirm' }
}

/** Tools offered to the model: a read-only person never sees writes. */
export function toolsFor(all: ToolDef[], role: AccountRole, readOnly: boolean): ToolDef[] {
  return all.filter((t) => t.risk === 'leitura' || (!readOnly && hasMinRole(role, t.minRole)))
}

/** How long a card stays valid. A reply approved tomorrow is worse than none. */
export const CARD_TTL_MS = 30 * 60_000

/** How long Undo stays available after something ran. */
export const UNDO_WINDOW_MS = 24 * 3_600_000
