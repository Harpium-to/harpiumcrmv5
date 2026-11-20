import type { SupabaseClient } from '@supabase/supabase-js'

import { slugifyTeamCode } from './destino'

// ============================================================
// Setores (migration 077): the shape the screens use, payload
// validation (pure) and the reads/writes behind /api/teams.
// ============================================================

export type TeamMode = 'rodizio' | 'menos_ocupado' | 'fila'
export type SlaAction = 'avisar' | 'proximo'

export interface Team {
  id: string
  name: string
  code: string
  description: string | null
  color: string
  mode: TeamMode
  online_only: boolean
  max_open_per_person: number | null
  sla_minutes: number | null
  sla_action: SlaAction
  is_entry: boolean
  active: boolean
  position: number
  /** user_ids of the people in it. */
  members: string[]
}

export const TEAM_MODE_LABEL: Record<TeamMode, string> = {
  rodizio: 'Rodízio',
  menos_ocupado: 'Quem tem menos conversas',
  fila: 'Fila (quem pegar primeiro)',
}

export const TEAM_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#64748b',
] as const

export interface TeamValues {
  name?: string
  description?: string | null
  color?: string
  mode?: TeamMode
  online_only?: boolean
  max_open_per_person?: number | null
  sla_minutes?: number | null
  sla_action?: SlaAction
  is_entry?: boolean
  active?: boolean
  position?: number
}

export type ParsedTeam =
  | { values: TeamValues; members?: string[] }
  | { error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalInt(
  raw: unknown,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false }
  return { ok: true, value: Math.min(max, Math.max(min, Math.floor(n))) }
}

/**
 * Validate a create (`partial: false`, name required) or an update
 * (`partial: true`, only what was sent). Pure.
 */
export function parseTeamPayload(body: unknown, opts: { partial: boolean }): ParsedTeam {
  if (!body || typeof body !== 'object') return { error: 'Corpo da requisição inválido' }
  const b = body as Record<string, unknown>
  const values: TeamValues = {}

  if ('name' in b || !opts.partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return { error: 'Dê um nome ao setor' }
    if (name.length > 60) return { error: 'O nome pode ter até 60 caracteres' }
    values.name = name
  }
  if ('description' in b) {
    const d = typeof b.description === 'string' ? b.description.trim() : ''
    if (d.length > 500) return { error: 'O texto do que o setor resolve pode ter até 500 caracteres' }
    values.description = d || null
  }
  if ('color' in b) {
    const c = typeof b.color === 'string' ? b.color.trim() : ''
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) return { error: 'Cor inválida' }
    values.color = c
  }
  if ('mode' in b) {
    if (b.mode !== 'rodizio' && b.mode !== 'menos_ocupado' && b.mode !== 'fila') {
      return { error: 'Escolha como o setor distribui: rodízio, menos ocupado ou fila' }
    }
    values.mode = b.mode
  }
  if ('online_only' in b) values.online_only = b.online_only === true
  if ('max_open_per_person' in b) {
    const n = optionalInt(b.max_open_per_person, 1, 500)
    if (!n.ok) return { error: 'Limite por pessoa inválido' }
    values.max_open_per_person = n.value
  }
  if ('sla_minutes' in b) {
    const n = optionalInt(b.sla_minutes, 1, 1440)
    if (!n.ok) return { error: 'Prazo inválido' }
    values.sla_minutes = n.value
  }
  if ('sla_action' in b) {
    if (b.sla_action !== 'avisar' && b.sla_action !== 'proximo') {
      return { error: 'Escolha o que fazer quando o prazo estoura' }
    }
    values.sla_action = b.sla_action
  }
  if ('is_entry' in b) values.is_entry = b.is_entry === true
  if ('active' in b) values.active = b.active === true
  if ('position' in b) {
    const p = Number(b.position)
    if (!Number.isFinite(p)) return { error: 'Posição inválida' }
    values.position = Math.max(0, Math.floor(p))
  }

  let members: string[] | undefined
  if ('members' in b) {
    if (!Array.isArray(b.members) || !b.members.every((m) => typeof m === 'string' && UUID_RE.test(m))) {
      return { error: 'Lista de pessoas inválida' }
    }
    members = Array.from(new Set(b.members as string[]))
  }

  return members ? { values, members } : { values }
}

/** A code no other setor of the CRM uses: "financeiro", "financeiro-2"… */
export function uniqueCode(name: string, taken: readonly string[]): string {
  const base = slugifyTeamCode(name)
  if (!taken.includes(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 36)}-${i}`
    if (!taken.includes(candidate)) return candidate
  }
  return `${base.slice(0, 30)}-${Date.now() % 100000}`
}

const TEAM_COLUMNS =
  'id, name, code, description, color, mode, online_only, max_open_per_person, sla_minutes, sla_action, is_entry, active, position'

/** The CRM's setores with their people. [] before migration 077. */
export async function listTeams(db: SupabaseClient, accountId: string): Promise<Team[]> {
  const [teamsRes, membersRes] = await Promise.all([
    db
      .from('teams')
      .select(TEAM_COLUMNS)
      .eq('account_id', accountId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    db.from('team_members').select('team_id, user_id').eq('account_id', accountId),
  ])
  if (teamsRes.error || membersRes.error) return []
  const byTeam = new Map<string, string[]>()
  for (const row of (membersRes.data ?? []) as { team_id: string; user_id: string }[]) {
    const list = byTeam.get(row.team_id) ?? []
    list.push(row.user_id)
    byTeam.set(row.team_id, list)
  }
  return ((teamsRes.data ?? []) as Omit<Team, 'members'>[]).map((t) => ({
    ...t,
    members: byTeam.get(t.id) ?? [],
  }))
}

/** Replace a setor's people with `members`. */
export async function setTeamMembers(
  db: SupabaseClient,
  accountId: string,
  teamId: string,
  members: string[],
): Promise<string | null> {
  const { data: current, error } = await db
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)
  if (error) return error.message
  const now = new Set(((current ?? []) as { user_id: string }[]).map((r) => r.user_id))
  const want = new Set(members)
  const remove = [...now].filter((u) => !want.has(u))
  const add = [...want].filter((u) => !now.has(u))

  if (remove.length > 0) {
    const { error: delErr } = await db
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .in('user_id', remove)
    if (delErr) return delErr.message
  }
  if (add.length > 0) {
    const { error: insErr } = await db
      .from('team_members')
      .insert(add.map((user_id) => ({ team_id: teamId, account_id: accountId, user_id })))
    if (insErr) {
      return insErr.code === '23503'
        ? 'Só pessoas da equipe deste CRM podem entrar num setor'
        : insErr.message
    }
  }
  return null
}

/** Only one entry setor per CRM: unmark the others before marking this one. */
export async function clearOtherEntry(
  db: SupabaseClient,
  accountId: string,
  exceptId: string | null,
): Promise<void> {
  let q = db.from('teams').update({ is_entry: false }).eq('account_id', accountId).eq('is_entry', true)
  if (exceptId) q = q.neq('id', exceptId)
  await q
}
