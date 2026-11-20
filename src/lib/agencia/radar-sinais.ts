import type { SupabaseClient } from '@supabase/supabase-js'

import type { CrmUsage } from './health'

// ============================================================
// The Radar of each client CRM in the agency console and the platform
// API (Fase 5 of docs/plano-radar-monitoramento.md): its open alerts of
// the last 7 days that need someone (not the good news), worst first.
// A database without 080 adds nothing.
// ============================================================

export interface RadarSignal {
  title: string
  severity: 'atencao' | 'alta'
}

/** Per CRM, worst first, at most `limit`. Pure. */
export function radarSignalsByAccount(
  rows: readonly { account_id: string; title: string; severity: string; tone: string; created_at: string }[],
  limit = 3,
): Map<string, RadarSignal[]> {
  const out = new Map<string, RadarSignal[]>()
  const sorted = [...rows]
    .filter((r) => r.tone !== 'bom')
    .sort(
      (a, b) =>
        (a.severity === 'alta' ? 0 : 1) - (b.severity === 'alta' ? 0 : 1) ||
        (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0),
    )
  for (const r of sorted) {
    const list = out.get(r.account_id) ?? []
    if (list.length < limit) list.push({ title: r.title, severity: r.severity === 'alta' ? 'alta' : 'atencao' })
    out.set(r.account_id, list)
  }
  return out
}

export async function addRadarSignals(admin: SupabaseClient, usage: Map<string, CrmUsage>): Promise<void> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data, error } = await admin
    .from('radar_alerts')
    .select('account_id, title, severity, tone, created_at')
    .eq('status', 'aberto')
    .gte('created_at', since)
    .limit(2000)
  if (error) return
  for (const [accountId, signals] of radarSignalsByAccount(
    (data ?? []) as { account_id: string; title: string; severity: string; tone: string; created_at: string }[],
  )) {
    const u = usage.get(accountId)
    if (u) u.radarAlerts = signals
  }
}
