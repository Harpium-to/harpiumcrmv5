import type { SupabaseClient } from '@supabase/supabase-js'

import { loadRadarSettings, radarRecipients } from './config'
import {
  BASELINE_WEEKS,
  detectDay,
  detectWeek,
  isLearning,
  Ledger,
  selectFindings,
  type Finding,
  type LedgerRow,
} from './deteccao'
import type { DailyContext, RadarState } from './livro'
import { addDays, weekdayOf } from './tempo'

// ============================================================
// The daily anomaly step (Fase 2): once yesterday is final, recompute
// it (late events), compare it — and on Mondays the week — with the
// normal of this CRM, store what stands out in radar_alerts (unique
// per period, so a second run adds nothing) and tell the people who
// receive the Radar, in one notification.
// ============================================================

/** Ledger rows from `from` to `to`, every metric. */
export async function loadLedger(
  db: SupabaseClient,
  accountId: string,
  from: string,
  to: string,
): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = []
  const PAGE = 1000
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const { data, error } = await db
      .from('metric_daily')
      .select('day, metric, dimension, value')
      .eq('account_id', accountId)
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true })
      .order('metric', { ascending: true })
      .order('dimension', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as { day: string; metric: string; dimension: string; value: number | string }[]
    rows.push(...batch.map((r) => ({ day: r.day, metric: r.metric, dimension: r.dimension, value: Number(r.value) })))
    if (batch.length < PAGE) break
  }
  return rows
}

export async function detectarStep(ctx: DailyContext): Promise<Partial<RadarState>> {
  const { admin, accountId, yesterday, today, tz, state } = ctx
  if (state.detected_through && state.detected_through >= yesterday) return {}

  const settings = await loadRadarSettings(admin, accountId)
  if (!settings.enabled || !state.tracked_since) return { detected_through: yesterday }

  // Late events of yesterday (a deal closed at 23:59, an import).
  await admin.rpc('radar_compute_days', { p_account: accountId, p_from: yesterday, p_to: yesterday, p_tz: tz })

  if (isLearning(yesterday, state.tracked_since, settings.minWeeks)) return { detected_through: yesterday }

  const from = addDays(yesterday, -7 * (BASELINE_WEEKS + 1) - 6)
  const ledger = new Ledger(await loadLedger(admin, accountId, from, yesterday))
  const opts = { sensitivity: settings.sensitivity, trackedSince: state.tracked_since, minWeeks: settings.minWeeks }

  const found: Finding[] = [...detectDay(ledger, yesterday, opts)]
  // The week, on the Monday after it (yesterday = Sunday).
  if (weekdayOf(yesterday) === 7) found.push(...detectWeek(ledger, yesterday, opts))

  const picked = selectFindings(found, {
    disabled: settings.disabledMetrics,
    snoozed: settings.snoozed,
    today,
  })
  if (picked.length === 0) return { detected_through: yesterday }

  const { data: inserted, error } = await admin
    .from('radar_alerts')
    .upsert(
      picked.map((f) => ({
        account_id: accountId,
        metric: f.metric,
        dimension: f.dimension,
        period: f.period,
        period_start: f.periodStart,
        period_end: f.periodEnd,
        value: f.value,
        expected: f.expected,
        direction: f.direction,
        tone: f.tone,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        href: f.href,
      })),
      { onConflict: 'account_id,metric,dimension,period,period_start', ignoreDuplicates: true },
    )
    .select('id, title, tone')
  if (error) throw new Error(error.message)

  // Tell people about new news that needs them (not the good news).
  const worth = ((inserted ?? []) as { title: string; tone: string }[]).filter((a) => a.tone !== 'bom')
  if (worth.length > 0) {
    const recipients = await radarRecipients(admin, accountId, settings)
    if (recipients.length > 0) {
      const body =
        worth.length === 1 ? worth[0].title : `${worth[0].title} · e mais ${worth.length - 1} no Radar`
      await admin.from('notifications').insert(
        recipients.map((userId) => ({
          account_id: accountId,
          user_id: userId,
          type: 'radar',
          title: worth.length === 1 ? 'Radar: 1 alerta novo' : `Radar: ${worth.length} alertas novos`,
          body,
        })),
      )
    }
  }
  return { detected_through: yesterday }
}
