import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { saveWhatsAppConnection } from '@/lib/whatsapp/connect'
import { supabaseAdmin } from '@/lib/whatsapp/admin-client'
import { requestCoexistenceSync } from '@/lib/whatsapp/coexistence'
import { resolveConnectionMode } from '@/lib/whatsapp/embedded-signup-client'
import {
  deriveRegistrationPin,
  discoverWabaAndPhone,
  exchangeCodeForBusinessToken,
  getEmbeddedSignupSettings,
} from '@/lib/whatsapp/embedded-signup'

/**
 * GET /api/whatsapp/embedded-signup
 *
 * What the settings screen needs to decide between the "Conectar com
 * o Facebook" button and the manual form. Nothing secret: the app id
 * and the configuration id are public by design (they go to the
 * Facebook SDK in the browser).
 */
export async function GET() {
  try {
    const { role } = await requireRole('viewer')
    const settings = getEmbeddedSignupSettings()
    return NextResponse.json({
      enabled: settings !== null,
      app_id: settings?.appId ?? null,
      config_id: settings?.configId ?? null,
      graph_version: settings?.graphVersion ?? null,
      can_manage: hasMinRole(role, 'admin'),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const ID_PATTERN = /^\d{5,25}$/

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null
}

/**
 * POST /api/whatsapp/embedded-signup
 *   { code, waba_id?, phone_number_id?, business_id?, mode?, event? }
 *
 * Finishes a connection after the customer completes Meta's popup:
 *   1. trade the code for the customer's business token (the code
 *      expires in ~30s, so this goes first);
 *   2. if the popup's session info didn't arrive, ask Meta which
 *      WhatsApp account and number the token covers;
 *   3. verify, register with a derived PIN, subscribe our app to the
 *      account's webhooks and save — the same path as the manual form.
 *      A number kept on the WhatsApp Business app (`mode`
 *      'coexistence', or the popup's coexistence event) is NOT
 *      registered: Meta already did it, and /register would take the
 *      number off the app;
 *   4. coexistence only: ask Meta for the phone's contacts and chat
 *      history, which then arrive through the webhook.
 *
 * Template sync is left to the browser right after this returns: it's
 * an existing authenticated route and a slow sync shouldn't hold the
 * connection hostage.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`wa-embedded-signup:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const settings = getEmbeddedSignupSettings()
    const appSecret = process.env.META_APP_SECRET?.trim()
    if (!settings || !appSecret) {
      return NextResponse.json(
        {
          error:
            'A conexão pelo Facebook não está configurada neste servidor. Use a configuração manual ou fale com a agência.',
        },
        { status: 503 },
      )
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!code) {
      return NextResponse.json(
        { error: 'A janela do Facebook não devolveu a autorização. Tente conectar de novo.' },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = await exchangeCodeForBusinessToken({
        code,
        appId: settings.appId,
        appSecret,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido na API da Meta'
      console.error('[embedded-signup] code exchange failed:', message)
      return NextResponse.json(
        {
          error:
            'A autorização do Facebook expirou ou foi recusada. Clique em Conectar e conclua a janela de novo.',
          detail: message,
        },
        { status: 400 },
      )
    }

    const mode = resolveConnectionMode(body?.mode, body?.event)

    let wabaId = optionalId(body?.waba_id)
    let phoneNumberId = optionalId(body?.phone_number_id)
    if (!wabaId || !phoneNumberId) {
      try {
        const found = await discoverWabaAndPhone({
          accessToken,
          appId: settings.appId,
          appSecret,
          wabaId,
        })
        wabaId = wabaId ?? found.wabaId
        phoneNumberId = phoneNumberId ?? found.phoneNumberId
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido na API da Meta'
        console.error('[embedded-signup] discovery failed:', message)
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }

    const result = await saveWhatsAppConnection({
      db: supabase,
      admin: supabaseAdmin(),
      accountId,
      userId,
      phoneNumberId,
      wabaId,
      accessToken,
      pin: mode === 'cloud' ? deriveRegistrationPin(phoneNumberId) : null,
      connectionMode: mode,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const sync =
      mode === 'coexistence'
        ? await requestCoexistenceSync({
            db: supabaseAdmin(),
            accountId,
            phoneNumberId,
            accessToken,
          })
        : null

    return NextResponse.json({
      success: result.registrationError === null,
      registered: result.registered,
      registration_error: result.registrationError,
      phone_info: result.phoneInfo,
      connection_mode: result.connectionMode,
      sync,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
