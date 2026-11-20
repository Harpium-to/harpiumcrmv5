import type { SupabaseClient } from '@supabase/supabase-js'

import type { Sensitivity } from './deteccao'

// ============================================================
// Configurações › Radar (radar_settings, 080): defaults, parsing, and
// who is told. Absent row = the defaults (§7 of the plan).
// ============================================================

export interface RadarSettings {
  enabled: boolean
  sensitivity: Sensitivity
  recipients: 'admins' | 'escolhidos'
  recipientIds: string[]
  digestEnabled: boolean
  /** ISO weekday, 1 = Monday. */
  digestWeekday: number
  digestHour: number
  disabledMetrics: string[]
  /** "metric|dimension" → last quiet day (YYYY-MM-DD). */
  snoozed: Record<string, string>
  showChanceToAgents: boolean
  minWeeks: number
}

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  enabled: true,
  sensitivity: 'normal',
  recipients: 'admins',
  recipientIds: [],
  digestEnabled: true,
  digestWeekday: 1,
  digestHour: 8,
  disabledMetrics: [],
  snoozed: {},
  showChanceToAgents: true,
  minWeeks: 4,
}

const SENS: readonly Sensitivity[] = ['baixa', 'normal', 'alta']

const intIn = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

export function parseRadarSettings(row: Record<string, unknown> | null | undefined): RadarSettings {
  if (!row) return { ...DEFAULT_RADAR_SETTINGS, snoozed: {} }
  const d = DEFAULT_RADAR_SETTINGS
  const snoozedRaw = row.snoozed && typeof row.snoozed === 'object' && !Array.isArray(row.snoozed) ? row.snoozed : {}
  return {
    enabled: row.enabled !== false,
    sensitivity: SENS.includes(row.sensitivity as Sensitivity) ? (row.sensitivity as Sensitivity) : d.sensitivity,
    recipients: row.recipients === 'escolhidos' ? 'escolhidos' : 'admins',
    recipientIds: Array.isArray(row.recipient_ids) ? (row.recipient_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    digestEnabled: row.digest_enabled !== false,
    digestWeekday: intIn(row.digest_weekday, 1, 7, d.digestWeekday),
    digestHour: intIn(row.digest_hour, 0, 23, d.digestHour),
    disabledMetrics: Array.isArray(row.disabled_metrics)
      ? (row.disabled_metrics as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    snoozed: Object.fromEntries(
      Object.entries(snoozedRaw as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e[1]),
      ),
    ),
    showChanceToAgents: row.show_chance_to_agents !== false,
    minWeeks: intIn(row.min_weeks, 2, 12, d.minWeeks),
  }
}

/** The settings as the database stores them. */
export function settingsToRow(s: RadarSettings): Record<string, unknown> {
  return {
    enabled: s.enabled,
    sensitivity: s.sensitivity,
    recipients: s.recipients,
    recipient_ids: s.recipientIds,
    digest_enabled: s.digestEnabled,
    digest_weekday: s.digestWeekday,
    digest_hour: s.digestHour,
    disabled_metrics: s.disabledMetrics,
    snoozed: s.snoozed,
    show_chance_to_agents: s.showChanceToAgents,
    min_weeks: s.minWeeks,
  }
}

export async function loadRadarSettings(db: SupabaseClient, accountId: string): Promise<RadarSettings> {
  const { data, error } = await db.from('radar_settings').select('*').eq('account_id', accountId).maybeSingle()
  if (error) return { ...DEFAULT_RADAR_SETTINGS, snoozed: {} }
  return parseRadarSettings(data as Record<string, unknown> | null)
}

/**
 * Who hears from the Radar: the owner and the admins, or the people
 * chosen — always among the CRM's members who are not viewers.
 */
export async function radarRecipients(
  admin: SupabaseClient,
  accountId: string,
  settings: RadarSettings,
): Promise<string[]> {
  const { data } = await admin.from('account_members').select('user_id, role').eq('account_id', accountId)
  const members = (data ?? []) as { user_id: string; role: string }[]
  if (settings.recipients === 'escolhidos' && settings.recipientIds.length > 0) {
    const chosen = new Set(settings.recipientIds)
    const picked = members.filter((m) => chosen.has(m.user_id) && m.role !== 'viewer').map((m) => m.user_id)
    if (picked.length > 0) return picked
  }
  return members.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.user_id)
}
