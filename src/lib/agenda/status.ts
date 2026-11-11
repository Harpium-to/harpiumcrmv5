// ============================================================
// What an agenda event's status is called, and what the database's
// refusals mean to a person. One file, so the grid, the dialog and
// whatever lists appointments next (the contact's record, Fase 2)
// say the same words.
// ============================================================

import type { AgendaEventStatus } from '@/types'

export const EVENT_STATUS_LABEL: Record<AgendaEventStatus, string> = {
  pending: 'Aguardando aprovação',
  scheduled: 'Marcado',
  confirmed: 'Confirmado',
  done: 'Realizado',
  no_show: 'Faltou',
  cancelled: 'Cancelado',
}

/** The order the dialog offers them in. Cancelling is its own button. */
export const EVENT_STATUS_STEPS: AgendaEventStatus[] = [
  'scheduled',
  'confirmed',
  'done',
  'no_show',
]

/** Colours the agenda form offers for a new agenda. */
export const CALENDAR_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#64748b',
]

/** Lengths the forms offer, in minutes. */
export const SLOT_OPTIONS = [10, 15, 20, 30, 40, 45, 50, 60, 90, 120]

/** How long before an appointment its reminder can go, in hours. */
export const REMINDER_HOURS_OPTIONS = [2, 4, 12, 24, 48]

/** "30 min", "1h", "1h30". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`
}

/** Zones the agenda form offers — Brazil's, by the city people know. */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília (São Paulo, Rio, Sul, Nordeste)' },
  { value: 'America/Manaus', label: 'Manaus (Amazonas, Rondônia, Roraima)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (Mato Grosso, Mato Grosso do Sul)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (Acre)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha' },
]

/**
 * A sentence for a failed write to the agenda. The codes are the ones
 * migration 067 raises; anything else gets the fallback.
 */
export function describeAgendaError(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): string {
  switch (error?.code) {
    case '23P01':
      return 'Esse horário já está ocupado nesta agenda.'
    case '42501':
      return 'Você não tem permissão para fazer isso.'
    case '23503':
      return 'O contato ou a agenda não pertence a este CRM.'
    case '23514':
      return 'Confira os dados: o fim precisa ser depois do início.'
    default:
      return fallback
  }
}
