import type { SupabaseClient } from '@supabase/supabase-js'

import { forecastMonth } from './chance'
import { loadRadarSettings, type RadarSettings } from './config'
import { isLearning } from './deteccao'
import { addDays, DEFAULT_TZ, localParts } from './tempo'

// ============================================================
// What the Radar screen and the Painel card show (GET /api/radar).
// Reads through the person's RLS client; the one function that needs
// the service role (cooling leads, 080) gets the CRM from the session.
// ============================================================

export interface RadarAlertView {
  id: string
  metric: string
  dimension: string
  period: 'dia' | 'semana'
  periodStart: string
  periodEnd: string
  direction: 'alta' | 'queda'
  tone: 'ruim' | 'bom' | 'neutro'
  severity: 'atencao' | 'alta'
  title: string
  detail: string | null
  href: string | null
  status: 'aberto' | 'visto' | 'ignorado'
  createdAt: string
}

export interface RadarPanel {
  available: boolean
  enabled: boolean
  /** Still learning the CRM's normal: no anomaly alerts until `readyOn`. */
  learning: { since: string; readyOn: string } | null
  updatedAt: string | null
  alerts: RadarAlertView[]
  forecast: {
    month: string
    expected: number
    low: number
    high: number
    deals: number
    withoutDate: number
    weak: boolean
  } | null
  cooling: { conversationId: string; contactId: string; name: string; temperature: string; waitingSince: string }[]
  stalled: { id: string; title: string; value: number; chance: number; days: number; stage: string | null }[]
  digest: { week: string; text: string; createdAt: string; byAi: boolean } | null
  showChance: boolean
  canManage: boolean
}

const EMPTY: RadarPanel = {
  available: false,
  enabled: false,
  learning: null,
  updatedAt: null,
  alerts: [],
  forecast: null,
  cooling: [],
  stalled: [],
  digest: null,
  showChance: false,
  canManage: false,
}

export async function loadRadarPanel(
  db: SupabaseClient,
  admin: SupabaseClient,
  ctx: { accountId: string; role: string; now?: Date },
): Promise<RadarPanel> {
  const now = ctx.now ?? new Date()
  const canManage = ctx.role === 'owner' || ctx.role === 'admin'

  const { data: stateRow, error: stateErr } = await db
    .from('radar_state')
    .select('*')
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  // Before 079 there is no Radar at all.
  if (stateErr) return { ...EMPTY, canManage }
  const state = stateRow as { timezone: string; tracked_since: string | null; today_refreshed_at: string | null } | null
  const settings: RadarSettings = await loadRadarSettings(db, ctx.accountId)
  const tz = state?.timezone || DEFAULT_TZ
  const today = localParts(now, tz).day

  const learning =
    !state?.tracked_since
      ? { since: today, readyOn: addDays(today, settings.minWeeks * 7) }
      : isLearning(today, state.tracked_since, settings.minWeeks)
        ? { since: state.tracked_since, readyOn: addDays(state.tracked_since, settings.minWeeks * 7) }
        : null

  const showChance = canManage || ctx.role !== 'agent' ? true : settings.showChanceToAgents

  const [alertsRes, dealsRes, ratesRes, stagesRes, digestRes, coolingRes] = await Promise.all([
    db
      .from('radar_alerts')
      .select('id, metric, dimension, period, period_start, period_end, direction, tone, severity, title, detail, href, status, created_at')
      .eq('account_id', ctx.accountId)
      .neq('status', 'ignorado')
      .gte('created_at', new Date(now.getTime() - 14 * 86_400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(30),
    db
      .from('deals')
      .select('id, title, value, status, stage_id, updated_at, expected_close_date, win_probability, win_probability_basis')
      .eq('account_id', ctx.accountId)
      .eq('status', 'open')
      .limit(5000),
    db.from('radar_stage_rates').select('stage_id, typical_days').eq('account_id', ctx.accountId),
    db.from('pipeline_stages').select('id, name'),
    db
      .from('radar_digests')
      .select('week, text, created_at, by_ai')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.rpc('radar_cooling_leads', { p_account: ctx.accountId, p_limit: 20 }),
  ])

  const alerts: RadarAlertView[] = ((alertsRes.error ? [] : alertsRes.data) ?? []).map((a: Record<string, unknown>) => ({
    id: String(a.id),
    metric: String(a.metric),
    dimension: String(a.dimension ?? ''),
    period: a.period as RadarAlertView['period'],
    periodStart: String(a.period_start),
    periodEnd: String(a.period_end),
    direction: a.direction as RadarAlertView['direction'],
    tone: a.tone as RadarAlertView['tone'],
    severity: a.severity as RadarAlertView['severity'],
    title: String(a.title),
    detail: (a.detail as string | null) ?? null,
    href: (a.href as string | null) ?? null,
    status: a.status as RadarAlertView['status'],
    createdAt: String(a.created_at),
  }))

  type OpenDeal = {
    id: string
    title: string
    value: number | string
    status: string
    stage_id: string | null
    updated_at: string
    expected_close_date: string | null
    win_probability: number | string | null
    win_probability_basis: string | null
  }
  const deals = (dealsRes.error ? [] : (dealsRes.data ?? [])) as OpenDeal[]
  const withChance = deals.filter((d) => d.win_probability !== null)

  let forecast: RadarPanel['forecast'] = null
  if (withChance.length > 0) {
    const month = today.slice(0, 7)
    const f = forecastMonth(
      deals.map((d) => ({
        value: Number(d.value) || 0,
        p: d.win_probability === null ? null : Number(d.win_probability),
        expected_close_date: d.expected_close_date,
        status: d.status,
      })),
      month,
    )
    const weak = withChance.filter((d) => d.win_probability_basis === 'fraca').length > withChance.length / 2
    forecast = { month, ...f, weak }
  }

  const typical = new Map(
    ((ratesRes.error ? [] : ratesRes.data) ?? []).map((r: { stage_id: string; typical_days: number }) => [
      r.stage_id,
      Number(r.typical_days) || 30,
    ]),
  )
  const stageName = new Map(((stagesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const stalled = withChance
    .map((d) => {
      const days = Math.floor((now.getTime() - Date.parse(d.updated_at)) / 86_400_000)
      const limit = d.stage_id ? typical.get(d.stage_id) ?? 30 : 30
      return {
        id: d.id,
        title: d.title,
        value: Number(d.value) || 0,
        chance: Number(d.win_probability),
        days,
        stage: d.stage_id ? stageName.get(d.stage_id) ?? null : null,
        late: days > limit && d.win_probability_basis === 'historico',
      }
    })
    .filter((d) => d.late && d.chance >= 0.4)
    .sort((a, b) => b.value * b.chance - a.value * a.chance)
    .slice(0, 10)
    .map(({ late: _late, ...rest }) => rest)

  const cooling = ((coolingRes.error ? [] : coolingRes.data) ?? []).map((r: Record<string, unknown>) => ({
    conversationId: String(r.conversation_id),
    contactId: String(r.contact_id),
    name: String(r.name ?? 'Contato'),
    temperature: String(r.temperature),
    waitingSince: String(r.waiting_since),
  }))

  const d = digestRes.error ? null : (digestRes.data as { week: string; text: string; created_at: string; by_ai: boolean } | null)

  return {
    available: true,
    enabled: settings.enabled,
    learning,
    updatedAt: state?.today_refreshed_at ?? null,
    alerts,
    forecast,
    cooling,
    stalled: showChance ? stalled : [],
    digest: d ? { week: d.week, text: d.text, createdAt: d.created_at, byAi: d.by_ai } : null,
    showChance,
    canManage,
  }
}
