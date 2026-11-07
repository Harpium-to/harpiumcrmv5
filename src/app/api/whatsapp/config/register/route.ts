import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { registerPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/config/register   { pin: "123456" }
 *
 * Register the already-saved number for this app's webhooks, using
 * the token on file. Exists for the one case the connect flows can't
 * finish alone: a number that already has a two-step verification PIN
 * someone else set (a number moved from another provider). The
 * customer types that PIN once, here, without ever handling a token —
 * which matters for Embedded Signup, where they never had one.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`wa-register:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { pin?: unknown } | null
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'O PIN precisa ter exatamente 6 dígitos.' },
        { status: 400 },
      )
    }

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[whatsapp/config/register] lookup failed:', error)
      return NextResponse.json({ error: 'Falha ao carregar a configuração' }, { status: 500 })
    }
    if (!config) {
      return NextResponse.json(
        { error: 'Nenhum WhatsApp conectado ainda.' },
        { status: 404 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json(
        {
          error:
            'O token guardado não pode ser decifrado. Desconecte e conecte o WhatsApp de novo.',
        },
        { status: 409 },
      )
    }

    try {
      await registerPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
        pin,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido na API da Meta'
      await supabase
        .from('whatsapp_config')
        .update({ last_registration_error: message, updated_at: new Date().toISOString() })
        .eq('account_id', accountId)
      return NextResponse.json(
        { error: `A Meta recusou o registro: ${message}` },
        { status: 400 },
      )
    }

    const now = new Date().toISOString()
    await supabase
      .from('whatsapp_config')
      .update({
        status: 'connected',
        registered_at: now,
        connected_at: now,
        last_registration_error: null,
        updated_at: now,
      })
      .eq('account_id', accountId)

    return NextResponse.json({ success: true, registered: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
