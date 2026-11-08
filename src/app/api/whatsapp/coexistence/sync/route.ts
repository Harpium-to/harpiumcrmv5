import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/whatsapp/admin-client'
import { requestCoexistenceSync } from '@/lib/whatsapp/coexistence'

/**
 * POST /api/whatsapp/coexistence/sync
 *
 * "Tentar de novo" on the status screen: asks Meta again for the
 * phone's contacts and chat history when the request made right after
 * connecting failed. Only what wasn't accepted yet is asked for; Meta
 * itself refuses once 24 hours have passed since the connection, and
 * that refusal is shown as is.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`wa-coexistence-sync:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, connection_mode')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[coexistence/sync] lookup failed:', error)
      return NextResponse.json({ error: 'Falha ao carregar a configuração' }, { status: 500 })
    }
    if (!config || config.connection_mode !== 'coexistence') {
      return NextResponse.json(
        { error: 'Este CRM não está conectado junto com o app WhatsApp Business.' },
        { status: 409 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json(
        { error: 'O token guardado não pode ser decifrado. Desconecte e conecte o WhatsApp de novo.' },
        { status: 409 },
      )
    }

    const sync = await requestCoexistenceSync({
      db: supabaseAdmin(),
      accountId,
      phoneNumberId: config.phone_number_id,
      accessToken,
    })
    if (sync.contacts === 'failed' || sync.history === 'failed') {
      return NextResponse.json(
        { error: `A Meta recusou o pedido: ${sync.error ?? 'erro desconhecido'}`, sync },
        { status: 400 },
      )
    }
    return NextResponse.json({ success: true, sync })
  } catch (err) {
    return toErrorResponse(err)
  }
}
