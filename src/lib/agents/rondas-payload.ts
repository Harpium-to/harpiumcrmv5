import { isRondaKind, rondaPreset } from './rondas-catalogo'

// ============================================================
// What the Rondas screen may write, checked in one place. Pure.
// ============================================================

export interface RondaValues {
  agent_id?: string
  name?: string
  check_kind?: string
  params?: Record<string, number>
  instruction?: string
  every_minutes?: number | null
  run_at?: string | null
  run_days?: number[]
  max_per_run?: number
  send_needs_approval?: boolean
  is_active?: boolean
}

export interface RondaRow {
  id: string
  agent_id: string
  name: string
  check_kind: string
  params: Record<string, unknown> | null
  instruction: string
  every_minutes: number | null
  run_at: string | null
  run_days: number[] | null
  max_per_run: number
  send_needs_approval: boolean
  is_active: boolean
  next_run_at: string
  last_run_at: string | null
  last_found: number | null
  last_note: string | null
  created_at: string
}

export const RONDA_COLUMNS =
  'id, agent_id, name, check_kind, params, instruction, every_minutes, run_at, run_days, max_per_run, send_needs_approval, is_active, next_run_at, last_run_at, last_found, last_note, created_at'

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/

export function parseRondaPayload(
  body: unknown,
  opts: { partial: boolean },
): { values: RondaValues } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Corpo inválido.' }
  const b = body as Record<string, unknown>
  const v: RondaValues = {}

  if (b.agentId !== undefined || !opts.partial) {
    if (typeof b.agentId !== 'string' || !b.agentId) return { error: 'Escolha o agente da ronda.' }
    v.agent_id = b.agentId
  }
  if (b.checkKind !== undefined || !opts.partial) {
    if (!isRondaKind(b.checkKind)) return { error: 'Tipo de ronda desconhecido.' }
    v.check_kind = b.checkKind
  }
  if (b.name !== undefined || !opts.partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name || name.length > 80) return { error: 'Dê um nome de até 80 caracteres à ronda.' }
    v.name = name
  }
  if (b.instruction !== undefined) {
    if (typeof b.instruction !== 'string' || b.instruction.length > 2000) return { error: 'A instrução tem no máximo 2000 caracteres.' }
    v.instruction = b.instruction.trim()
  }
  if (b.param !== undefined) {
    const kind = v.check_kind ?? (typeof b.checkKindForParam === 'string' ? b.checkKindForParam : undefined)
    const preset = kind ? rondaPreset(kind) : undefined
    if (preset?.param) {
      const n = Number(b.param)
      if (!Number.isFinite(n) || n < preset.param.min || n > preset.param.max) {
        return { error: `${preset.param.label}: entre ${preset.param.min} e ${preset.param.max}.` }
      }
      v.params = { [preset.param.key]: Math.round(n) }
    }
  }
  // Schedule: every N minutes, or daily at HH:MM on some weekdays.
  if (b.everyMinutes !== undefined || b.runAt !== undefined || !opts.partial) {
    const every = b.everyMinutes === null || b.everyMinutes === undefined || b.everyMinutes === '' ? null : Number(b.everyMinutes)
    const runAt = typeof b.runAt === 'string' && b.runAt ? b.runAt.trim() : null
    if (every !== null) {
      if (!Number.isFinite(every) || every < 15 || every > 1440) return { error: 'A ronda roda a cada 15 a 1440 minutos.' }
      v.every_minutes = Math.round(every)
      v.run_at = null
    } else if (runAt) {
      if (!HM.test(runAt)) return { error: 'Horário inválido (use HH:MM).' }
      v.run_at = runAt
      v.every_minutes = null
    } else {
      return { error: 'Diga de quanto em quanto tempo, ou a que horas, a ronda roda.' }
    }
  }
  if (b.runDays !== undefined) {
    const days = Array.isArray(b.runDays) ? [...new Set(b.runDays.map(Number))].filter((d) => d >= 1 && d <= 7) : []
    if (days.length === 0) return { error: 'Escolha pelo menos um dia.' }
    v.run_days = days.sort()
  }
  if (b.maxPerRun !== undefined) {
    const n = Number(b.maxPerRun)
    if (!Number.isFinite(n) || n < 1 || n > 20) return { error: 'De 1 a 20 casos por ronda.' }
    v.max_per_run = Math.round(n)
  }
  if (b.sendNeedsApproval !== undefined) v.send_needs_approval = b.sendNeedsApproval !== false
  if (b.isActive !== undefined) v.is_active = b.isActive !== false
  return { values: v }
}
