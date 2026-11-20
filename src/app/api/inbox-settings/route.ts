import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadInboxSettings, parseInboxSettings } from '@/lib/atendimento/chegada'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/inbox-settings  (any member) — the CRM's arrival and return
 *                          rules (078), defaults filled in.
 * PUT /api/inbox-settings  (admin+)     — change them.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    return NextResponse.json({ settings: await loadInboxSettings(supabase, accountId) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Corpo da requisição inválido' }, { status: 400 })

    // Unknown values fall back to the defaults in the parser; check the
    // ones a person chose so a typo is an error, not a silent default.
    if (body.arrival_mode !== undefined &&
        !['fila_geral', 'rodizio', 'setor_entrada', 'por_canal'].includes(String(body.arrival_mode))) {
      return NextResponse.json({ error: 'Regra de chegada inválida' }, { status: 400 })
    }
    if (body.return_mode !== undefined &&
        !['mesma_pessoa', 'ia', 'distribuir'].includes(String(body.return_mode))) {
      return NextResponse.json({ error: 'Regra de retorno inválida' }, { status: 400 })
    }

    const settings = parseInboxSettings(body)

    // Each channel's rule: 'fila', 'rodizio', or a setor of this CRM.
    const teamIds = Object.values(settings.arrivalByChannel).filter((v) => UUID_RE.test(v))
    for (const [channel, rule] of Object.entries(settings.arrivalByChannel)) {
      if (rule !== 'fila' && rule !== 'rodizio' && !UUID_RE.test(rule)) {
        return NextResponse.json({ error: `Regra inválida para ${channel}` }, { status: 400 })
      }
    }
    if (teamIds.length > 0) {
      const { data: found } = await supabase
        .from('teams')
        .select('id')
        .eq('account_id', accountId)
        .in('id', teamIds)
      if ((found ?? []).length !== new Set(teamIds).size) {
        return NextResponse.json({ error: 'Um dos setores escolhidos não existe neste CRM' }, { status: 400 })
      }
    }

    const { error } = await supabase.from('inbox_settings').upsert(
      {
        account_id: accountId,
        arrival_mode: settings.arrivalMode,
        arrival_by_channel: settings.arrivalByChannel,
        return_mode: settings.returnMode,
        return_days: settings.returnDays,
      },
      { onConflict: 'account_id' },
    )
    if (error) {
      console.error('[inbox-settings PUT] error:', error)
      return NextResponse.json({ error: 'Falha ao salvar as regras' }, { status: 500 })
    }
    return NextResponse.json({ settings })
  } catch (err) {
    return toErrorResponse(err)
  }
}
