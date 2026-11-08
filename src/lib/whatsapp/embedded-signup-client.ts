// ============================================================
// Embedded Signup — the browser side's pure helpers.
//
// Meta's popup talks to the page through window.postMessage. Anything
// can post a message to a window, so the origin is checked strictly
// and the payload is parsed defensively: a malformed or foreign message
// is ignored, never trusted.
// ============================================================

import type { ConnectionMode } from './connect'

/**
 * True only for facebook.com itself or one of its subdomains.
 *
 * Meta's sample uses `origin.endsWith('facebook.com')`, which would
 * also accept "https://evilfacebook.com". Comparing the parsed host
 * closes that gap.
 */
export function isFacebookOrigin(origin: string): boolean {
  let host: string
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:') return false
    host = url.hostname
  } catch {
    return false
  }
  return host === 'facebook.com' || host.endsWith('.facebook.com')
}

export type EmbeddedSignupMessage =
  | {
      kind: 'finish'
      /** FINISH, FINISH_ONLY_WABA, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING… */
      event: string
      wabaId?: string
      phoneNumberId?: string
      businessId?: string
    }
  | { kind: 'cancel'; step?: string }
  | { kind: 'error'; message?: string; code?: string }

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number') return String(value)
  return undefined
}

/**
 * Read a `WA_EMBEDDED_SIGNUP` message, or null for anything else.
 * Meta sends the payload as a JSON string; an already-parsed object is
 * accepted too.
 */
export function parseEmbeddedSignupMessage(raw: unknown): EmbeddedSignupMessage | null {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object') return null
  const msg = data as { type?: unknown; event?: unknown; data?: Record<string, unknown> }
  if (msg.type !== 'WA_EMBEDDED_SIGNUP') return null

  const event = typeof msg.event === 'string' ? msg.event : ''
  const payload = msg.data && typeof msg.data === 'object' ? msg.data : {}

  if (event.startsWith('FINISH')) {
    return {
      kind: 'finish',
      event,
      wabaId: asString(payload.waba_id),
      phoneNumberId: asString(payload.phone_number_id),
      businessId: asString(payload.business_id),
    }
  }
  if (event === 'CANCEL') {
    return { kind: 'cancel', step: asString(payload.current_step) }
  }
  if (event === 'ERROR') {
    return {
      kind: 'error',
      message: asString(payload.error_message),
      code: asString(payload.error_code),
    }
  }
  return null
}

// ---- Coexistence (W3) ---------------------------------------

/** Session event Meta's popup posts when the coexistence flow ends. */
export const COEXISTENCE_FINISH_EVENT = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'

/**
 * Which mode a finished popup connected. The popup's own event wins:
 * the coexistence flow lets the business switch to "use a new number"
 * halfway, and the two modes need opposite registration steps. The
 * option the user picked on our card only decides when the event never
 * reached the page.
 */
export function resolveConnectionMode(
  requested: unknown,
  event: unknown,
): ConnectionMode {
  if (typeof event === 'string' && event.startsWith('FINISH')) {
    return event === COEXISTENCE_FINISH_EVENT ? 'coexistence' : 'cloud'
  }
  return requested === 'coexistence' ? 'coexistence' : 'cloud'
}

/** The FB.login extras for each mode (Embedded Signup v4). */
export function embeddedSignupExtras(mode: ConnectionMode): Record<string, unknown> {
  return mode === 'coexistence'
    ? {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        sessionInfoVersion: '3',
      }
    : { setup: {} }
}
