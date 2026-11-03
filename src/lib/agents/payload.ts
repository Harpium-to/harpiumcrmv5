import { NextResponse } from 'next/server'
import { fold } from './routing'
import { sanitizeChannels, sanitizeTools } from './tools'
import { parseTimeOfDay } from './schedule'
import { toAutonomy, type ActionKind } from './autonomy'

// ============================================================
// Request-body validation for the agent routes.
//
// Pure — no database, no client. The one field that would need a
// lookup (`handoff_agent_id`, which must be a member of the account)
// is deliberately not accepted here: agents inherit the account-level
// handoff target that `ai_configs` already validates, and accepting an
// unvalidated user id would let an admin route conversations at
// somebody outside their account. The column exists in the schema for
// when the form grows a member picker; until then there is nothing to
// validate because nothing can set it.
// ============================================================

export function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const MAX_KEYWORDS = 40
const MAX_KEYWORD_LENGTH = 60
const MAX_PROMPT_LENGTH = 8000

/** Column-shaped values, ready to hand to PostgREST. */
export interface AgentValues {
  name?: string
  role?: string
  avatar_url?: string | null
  objective?: string | null
  autonomy?: number
  tools?: string[]
  channels?: string[]
  require_approval_for?: string[]
  work_days?: number[]
  work_start?: string
  work_end?: string
  timezone?: string
  goals?: Record<string, number>
  department?: string
  system_prompt?: string
  model?: string | null
  keywords?: string[]
  priority?: number
  is_fallback?: boolean
  is_active?: boolean
  max_replies_per_conversation?: number
}

/**
 * Actions an operator may pin to always-ask. Checked against the
 * vocabulary so a typo becomes a 400 rather than a rule that silently
 * never fires — "I set it to require approval and it sent anyway" is
 * the worst possible failure mode for this field.
 */
const APPROVABLE_ACTIONS: ActionKind[] = [
  'create_lead',
  'update_crm',
  'create_deal',
  'move_stage',
  'log_activity',
  'send_message',
  'schedule_meeting',
  'delegate_task',
  'send_proposal',
  'give_discount',
  'close_deal',
  'delete_data',
]

/** ISO weekdays, deduplicated and ordered. Anything else is dropped. */
export function normalizeWorkDays(input: unknown): number[] {
  const raw = Array.isArray(input) ? input : []
  const seen = new Set<number>()
  for (const item of raw) {
    const n = Math.round(Number(item))
    if (Number.isFinite(n) && n >= 1 && n <= 7) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * {metric: target} with finite, positive integers only.
 *
 * A target of zero is dropped rather than stored, because it is not a
 * target — it is the absence of one, and keeping it would put a metric
 * the agent is not measured on into every prompt and every report.
 * That makes clearing a goal the same gesture as typing 0, which is
 * how people expect a numeric field to work.
 */
export function normalizeGoals(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) continue
    // Keys become metric identifiers, so keep them boring.
    const slug = key.trim().slice(0, 40)
    if (slug) out[slug] = Math.round(n)
  }
  return out
}

export type ParseResult =
  | { values: AgentValues }
  | { error: string }

/**
 * Accepts either an array or a comma-separated string, because the
 * form sends the latter and the preset catalogue holds the former.
 *
 * Deduplicates on the *folded* form so "Preço" and "preco" don't both
 * end up in the list — they match identically at routing time, and a
 * list that shows the same rule twice makes the operator think one of
 * them does something different.
 */
export function normalizeKeywords(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.filter((k): k is string => typeof k === 'string')
    : typeof input === 'string'
      ? input.split(',')
      : []

  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const trimmed = item.trim().slice(0, MAX_KEYWORD_LENGTH)
    if (!trimmed) continue
    const key = fold(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length >= MAX_KEYWORDS) break
  }
  return out
}

/**
 * Validate an agent create/update body.
 *
 * `partial: true` (PATCH) only validates the fields that are present,
 * so the team screen's on/off switch can send `{ is_active }` alone.
 * `partial: false` (POST) additionally requires the two fields an
 * agent cannot exist without: a name and a persona.
 */
export function parseAgentPayload(
  body: unknown,
  opts: { partial: boolean },
): ParseResult {
  if (!body || typeof body !== 'object') return { error: 'Corpo inválido' }
  const b = body as Record<string, unknown>
  const values: AgentValues = {}

  if ('name' in b || !opts.partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return { error: 'O nome é obrigatório' }
    if (name.length > 80) return { error: 'O nome deve ter no máximo 80 caracteres' }
    values.name = name
  }

  if ('system_prompt' in b || !opts.partial) {
    const prompt =
      typeof b.system_prompt === 'string' ? b.system_prompt.trim() : ''
    if (!prompt) return { error: 'As instruções são obrigatórias' }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return { error: `As instruções devem ter no máximo ${MAX_PROMPT_LENGTH} caracteres` }
    }
    values.system_prompt = prompt
  }

  if ('role' in b) {
    const role = typeof b.role === 'string' ? b.role.trim() : ''
    values.role = role || 'custom'
  }

  if ('avatar_url' in b) {
    const url = typeof b.avatar_url === 'string' ? b.avatar_url.trim() : ''
    values.avatar_url = url || null
  }

  if ('objective' in b) {
    const objective = typeof b.objective === 'string' ? b.objective.trim() : ''
    values.objective = objective ? objective.slice(0, 400) : null
  }

  if ('autonomy' in b) values.autonomy = toAutonomy(b.autonomy)

  if ('tools' in b) values.tools = sanitizeTools(b.tools)
  if ('channels' in b) values.channels = sanitizeChannels(b.channels)

  if ('require_approval_for' in b) {
    const raw = Array.isArray(b.require_approval_for)
      ? b.require_approval_for
      : []
    const picked = raw.filter(
      (a): a is string =>
        typeof a === 'string' &&
        (APPROVABLE_ACTIONS as string[]).includes(a),
    )
    values.require_approval_for = [...new Set(picked)]
  }

  if ('work_days' in b) values.work_days = normalizeWorkDays(b.work_days)

  if ('work_start' in b || 'work_end' in b) {
    const start =
      typeof b.work_start === 'string' ? b.work_start.trim() : undefined
    const end = typeof b.work_end === 'string' ? b.work_end.trim() : undefined
    if (start !== undefined) {
      if (parseTimeOfDay(start) === null) return { error: 'Horário de início inválido' }
      values.work_start = start
    }
    if (end !== undefined) {
      if (parseTimeOfDay(end) === null) return { error: 'Horário de término inválido' }
      values.work_end = end
    }
  }

  if ('timezone' in b) {
    const tz = typeof b.timezone === 'string' ? b.timezone.trim() : ''
    // Reject an unknown zone here rather than letting it fail inside
    // the scheduler, where the agent would silently fall back to UTC
    // and work the wrong hours.
    if (tz) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
      } catch {
        return { error: 'Fuso horário inválido' }
      }
      values.timezone = tz
    }
  }

  if ('goals' in b) values.goals = normalizeGoals(b.goals)

  if ('department' in b) {
    const dept = typeof b.department === 'string' ? b.department.trim() : ''
    values.department = dept || 'geral'
  }

  if ('model' in b) {
    const model = typeof b.model === 'string' ? b.model.trim() : ''
    // Empty means "inherit the account model" — stored as NULL, not as
    // an empty string, so the inheritance check stays a null check.
    values.model = model || null
  }

  if ('keywords' in b) {
    values.keywords = normalizeKeywords(b.keywords)
  }

  if ('priority' in b) {
    const priority = Number(b.priority)
    if (!Number.isFinite(priority)) return { error: 'Prioridade inválida' }
    values.priority = Math.min(100, Math.max(0, Math.floor(priority)))
  }

  if ('is_fallback' in b) values.is_fallback = b.is_fallback === true
  if ('is_active' in b) values.is_active = b.is_active === true

  if ('max_replies_per_conversation' in b) {
    const max = Number(b.max_replies_per_conversation)
    if (!Number.isFinite(max)) return { error: 'Limite de respostas inválido' }
    values.max_replies_per_conversation = Math.min(20, Math.max(1, Math.floor(max)))
  }

  return { values }
}
