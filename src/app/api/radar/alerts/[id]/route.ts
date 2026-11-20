import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadRadarSettings, settingsToRow } from '@/lib/radar/config'
import { addDays, DEFAULT_TZ, localParts } from '@/lib/radar/tempo'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/radar/alerts/[id]  (agent+)
 *   { status: 'visto' }                      seen
 *   { status: 'ignorado', ignorar_dias?: n } ignored (admin+); with days,
 *                                            that alert stays quiet for n days
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, role } = await requireRole('agent')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { status?: string; ignorar_dias?: number } | null
    const status = body?.status
    if (status !== 'visto' && status !== 'ignorado' && status !== 'aberto') {
      return NextResponse.json({ error: 'Informe visto ou ignorado' }, { status: 400 })
    }

    const { error } = await supabase.rpc('radar_set_alert_status', { p_alert_id: id, p_status: status })
    if (error) {
      const code = error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500
      return NextResponse.json({ error: error.message }, { status: code })
    }

    const days = Number(body?.ignorar_dias)
    if (status === 'ignorado' && Number.isInteger(days) && days > 0 && days <= 90 && (role === 'owner' || role === 'admin')) {
      const { data: alert } = await supabase.from('radar_alerts').select('metric, dimension').eq('id', id).maybeSingle()
      if (alert) {
        const settings = await loadRadarSettings(supabase, accountId)
        const { data: state } = await supabase.from('radar_state').select('timezone').eq('account_id', accountId).maybeSingle()
        const today = localParts(new Date(), (state as { timezone?: string } | null)?.timezone || DEFAULT_TZ).day
        const key = `${(alert as { metric: string }).metric}|${(alert as { dimension: string }).dimension}`
        const snoozed = { ...settings.snoozed, [key]: addDays(today, days) }
        await supabase
          .from('radar_settings')
          .upsert({ account_id: accountId, ...settingsToRow({ ...settings, snoozed }) }, { onConflict: 'account_id' })
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
