import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { ALERT_KEYS } from '@/lib/radar/metricas'
import { loadRadarSettings, parseRadarSettings, settingsToRow, type RadarSettings } from '@/lib/radar/config'

/**
 * GET /api/radar/settings  (any member) — Configurações › Radar.
 * PUT /api/radar/settings  (admin+)     — change them (partial: only what is sent).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    return NextResponse.json({ settings: await loadRadarSettings(supabase, accountId), alertKeys: ALERT_KEYS })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Partial<RadarSettings> | null
    if (!body) return NextResponse.json({ error: 'Corpo da requisição inválido' }, { status: 400 })

    const current = await loadRadarSettings(supabase, accountId)
    const merged = { ...current, ...body }
    // Parse as if it came from the database: unknown values fall back.
    const next = parseRadarSettings(settingsToRow(merged as RadarSettings))
    if (body.sensitivity && body.sensitivity !== next.sensitivity) {
      return NextResponse.json({ error: 'Sensibilidade inválida' }, { status: 400 })
    }
    const known = new Set(ALERT_KEYS.map((k) => k.key))
    next.disabledMetrics = next.disabledMetrics.filter((k) => known.has(k))

    if (next.recipients === 'escolhidos' && next.recipientIds.length > 0) {
      const { data: members } = await supabase
        .from('account_members')
        .select('user_id, role')
        .eq('account_id', accountId)
        .in('user_id', next.recipientIds)
      next.recipientIds = ((members ?? []) as { user_id: string; role: string }[])
        .filter((m) => m.role !== 'viewer')
        .map((m) => m.user_id)
    }

    const { error } = await supabase
      .from('radar_settings')
      .upsert({ account_id: accountId, ...settingsToRow(next) }, { onConflict: 'account_id' })
    if (error) {
      console.error('[radar settings PUT] error:', error)
      return NextResponse.json({ error: 'Falha ao salvar' }, { status: 500 })
    }
    return NextResponse.json({ settings: next })
  } catch (err) {
    return toErrorResponse(err)
  }
}
