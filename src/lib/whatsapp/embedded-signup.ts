import { createHmac } from 'crypto'
import { META_API_BASE, META_API_VERSION, throwMetaError } from './meta-api'

// ============================================================
// Embedded Signup ("Cadastro incorporado") — server side.
//
// The customer clicks "Conectar com o Facebook" in the CRM, goes
// through Meta's popup (picks or creates the business, the WhatsApp
// account and the number, confirms the SMS code) and the popup hands
// the browser three things: an exchangeable `code`, the WABA id and
// the phone number id. Everything below turns that into a working
// connection without the customer ever seeing a token, an id or a PIN.
//
// Docs (Tech Provider flow):
//   developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
// ============================================================

/** What the browser needs to open the popup. None of it is secret. */
export interface EmbeddedSignupSettings {
  appId: string
  configId: string
  graphVersion: string
}

/**
 * Read the Embedded Signup settings from the environment.
 *
 * Returns null when any piece is missing — the UI then keeps showing
 * the manual form only. The app secret is required too even though it
 * never leaves the server: without it the code exchange can't happen,
 * and offering a button that always fails is worse than not offering it.
 */
export function getEmbeddedSignupSettings(
  env: Record<string, string | undefined> = process.env,
): EmbeddedSignupSettings | null {
  const appId = env.META_APP_ID?.trim()
  const configId = env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim()
  const appSecret = env.META_APP_SECRET?.trim()
  if (!appId || !configId || !appSecret) return null
  return { appId, configId, graphVersion: META_API_VERSION }
}

export interface ExchangeCodeArgs {
  code: string
  appId: string
  appSecret: string
}

/**
 * Trade the popup's code for the customer's business token.
 *
 * The code lives for about 30 seconds, so this runs as the very first
 * step of the connect request. No redirect_uri: the JavaScript SDK flow
 * doesn't use one and Meta rejects a mismatched one.
 */
export async function exchangeCodeForBusinessToken(
  args: ExchangeCodeArgs,
): Promise<string> {
  const { code, appId, appSecret } = args
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  })
  const response = await fetch(`${META_API_BASE}/oauth/access_token?${params}`)
  if (!response.ok) {
    await throwMetaError(response, `Erro na API da Meta: ${response.status}`)
  }
  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('A Meta não devolveu o token da empresa.')
  }
  return data.access_token
}

export interface DiscoverArgs {
  accessToken: string
  appId: string
  appSecret: string
}

export interface DiscoveredNumber {
  wabaId: string
  phoneNumberId: string
}

interface GranularScope {
  scope?: string
  target_ids?: string[]
}

/**
 * Fallback for when the popup's session info didn't reach the page
 * (an extension eating postMessage, the customer closing the tab at
 * the wrong moment): ask Meta which WhatsApp account the token was
 * granted on, then take that account's number.
 *
 * The app token goes in the Authorization header rather than the
 * query string so it never lands in a URL log.
 */
export async function discoverWabaAndPhone(
  args: DiscoverArgs,
): Promise<DiscoveredNumber> {
  const { accessToken, appId, appSecret } = args

  const debugRes = await fetch(
    `${META_API_BASE}/debug_token?${new URLSearchParams({ input_token: accessToken })}`,
    { headers: { Authorization: `Bearer ${appId}|${appSecret}` } },
  )
  if (!debugRes.ok) {
    await throwMetaError(debugRes, `Erro na API da Meta: ${debugRes.status}`)
  }
  const debug = (await debugRes.json()) as {
    data?: { granular_scopes?: GranularScope[] }
  }
  const scopes = debug.data?.granular_scopes ?? []
  const wabaId =
    scopes.find((s) => s.scope === 'whatsapp_business_management')
      ?.target_ids?.[0] ??
    scopes.find((s) => s.scope === 'whatsapp_business_messaging')
      ?.target_ids?.[0]
  if (!wabaId) {
    throw new Error(
      'Não encontramos a conta do WhatsApp autorizada. Refaça a conexão e conclua todas as etapas da janela do Facebook.',
    )
  }

  const phonesRes = await fetch(
    `${META_API_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!phonesRes.ok) {
    await throwMetaError(phonesRes, `Erro na API da Meta: ${phonesRes.status}`)
  }
  const phones = (await phonesRes.json()) as { data?: { id?: string }[] }
  const phoneNumberId = phones.data?.find((p) => p.id)?.id
  if (!phoneNumberId) {
    throw new Error(
      'A conta do WhatsApp não tem número. Refaça a conexão e adicione o número na janela do Facebook.',
    )
  }
  return { wabaId, phoneNumberId }
}

/**
 * The 6-digit two-step verification PIN for a number we connect.
 *
 * /register sets this PIN on a number that has none, and asks for it
 * again on every later registration. Deriving it from the server's
 * ENCRYPTION_KEY (instead of picking a random one) means it can be
 * recomputed whenever a re-registration is needed, with no column to
 * store it in. Anyone who could recompute it already holds the key
 * that decrypts the access tokens, so it doesn't widen anything.
 */
export function deriveRegistrationPin(
  phoneNumberId: string,
  secret: string | undefined = process.env.ENCRYPTION_KEY,
): string {
  if (!secret) {
    throw new Error('ENCRYPTION_KEY não está configurada no servidor.')
  }
  const digest = createHmac('sha256', secret)
    .update(`whatsapp-2fa-pin:${phoneNumberId}`)
    .digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}
