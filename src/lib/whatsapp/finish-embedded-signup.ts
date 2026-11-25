// ============================================================
// Finish an Embedded Signup connection.
//
// One implementation for both ways in: the "Conectar com o Facebook"
// button inside the CRM (/api/whatsapp/embedded-signup) and the link
// that works without login (/api/conectar-whatsapp/<token>, migration
// 081). Same steps, same end state:
//   1. trade the code for the customer's business token (the code
//      expires in ~30s, so this goes first);
//   2. if the popup's session info didn't arrive, ask Meta which
//      WhatsApp account and number the token covers;
//   3. verify, register with a derived PIN, subscribe our app to the
//      account's webhooks and save — the same path as the manual form.
//      A number kept on the WhatsApp Business app (coexistence) is NOT
//      registered: Meta already did it, and /register would take the
//      number off the app;
//   4. coexistence only: ask Meta for the phone's contacts and chat
//      history, which then arrive through the webhook.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { saveWhatsAppConnection } from './connect'
import { requestCoexistenceSync } from './coexistence'
import { resolveConnectionMode } from './embedded-signup-client'
import {
  deriveRegistrationPin,
  discoverWabaAndPhone,
  exchangeCodeForBusinessToken,
  getEmbeddedSignupSettings,
} from './embedded-signup'

const ID_PATTERN = /^\d{5,25}$/

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null
}

export interface FinishEmbeddedSignupArgs {
  /** Writes the CRM's whatsapp_config row (RLS client, or service role
   *  for the link without login). */
  db: SupabaseClient
  /** Service role: sees numbers claimed by other CRMs. */
  admin: SupabaseClient
  accountId: string
  /** Audit column on whatsapp_config. */
  userId: string
  /** The browser's body: { code, waba_id?, phone_number_id?, business_id?, mode?, event? } */
  body: Record<string, unknown> | null
}

export interface FinishEmbeddedSignupResult {
  status: number
  body: Record<string, unknown>
  /** The connection was saved (even if registration needs attention). */
  saved: boolean
}

export async function finishEmbeddedSignup(
  args: FinishEmbeddedSignupArgs,
): Promise<FinishEmbeddedSignupResult> {
  const { db, admin, accountId, userId, body } = args
  const refuse = (status: number, b: Record<string, unknown>) => ({ status, body: b, saved: false })

  const settings = getEmbeddedSignupSettings()
  const appSecret = process.env.META_APP_SECRET?.trim()
  if (!settings || !appSecret) {
    return refuse(503, {
      error:
        'A conexão pelo Facebook não está configurada neste servidor. Use a configuração manual ou fale com a agência.',
    })
  }

  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) {
    return refuse(400, {
      error: 'A janela do Facebook não devolveu a autorização. Tente conectar de novo.',
    })
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
    return refuse(400, {
      error:
        'A autorização do Facebook expirou ou foi recusada. Clique em Conectar e conclua a janela de novo.',
      detail: message,
    })
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
      return refuse(400, { error: message })
    }
  }

  const result = await saveWhatsAppConnection({
    db,
    admin,
    accountId,
    userId,
    phoneNumberId,
    wabaId,
    accessToken,
    pin: mode === 'cloud' ? deriveRegistrationPin(phoneNumberId) : null,
    connectionMode: mode,
  })

  if (!result.ok) return refuse(result.status, { error: result.error })

  const sync =
    mode === 'coexistence'
      ? await requestCoexistenceSync({
          db: admin,
          accountId,
          phoneNumberId,
          accessToken,
        })
      : null

  return {
    status: 200,
    saved: true,
    body: {
      success: result.registrationError === null,
      registered: result.registered,
      registration_error: result.registrationError,
      phone_info: result.phoneInfo,
      connection_mode: result.connectionMode,
      sync,
    },
  }
}
