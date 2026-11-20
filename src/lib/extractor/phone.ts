import { normalizeLeadPhone } from '@/lib/leads/parse'
import { equivalentPhoneKeys, normalizePhone } from '@/lib/whatsapp/phone-utils'

import type { PhoneKind } from './types'

// ============================================================
// Phones of extracted leads. Pure.
//
// The CRM's own rule decides what "the same number" is
// (equivalentPhoneKeys); this adds what the extractor needs to know
// before a send: is it a mobile or a landline? A landline almost never
// has WhatsApp.
// ============================================================

/** "+5562999990000" from whatever the source wrote, or null. */
export function leadPhone(raw: string | null | undefined): string | null {
  const phone = normalizeLeadPhone(raw)
  if (!phone) return null
  const digits = normalizePhone(phone)
  // A Brazilian number is 55 + DDD + 8 or 9 digits.
  if (digits.startsWith('55') && digits.length !== 12 && digits.length !== 13) return null
  return phone
}

/**
 * Brazilian numbers only: 9 digits after the DDD starting with 9 is a
 * mobile; 8 digits starting with 2–5 is a landline. Anything else
 * (another country, an odd length) is unknown.
 */
export function phoneKind(phone: string | null | undefined): PhoneKind | null {
  const digits = normalizePhone(phone ?? '')
  const mobile = /^55[1-9]{2}9\d{8}$/.test(digits)
  if (mobile) return 'celular'
  if (/^55[1-9]{2}[2-5]\d{7}$/.test(digits)) return 'fixo'
  return null
}

/** Every key the CRM may hold this number under (ninth digit or not). */
export function phoneKeys(phone: string | null | undefined): string[] {
  return phone ? equivalentPhoneKeys(phone) : []
}

/** Of two numbers of one company, the one worth writing to. */
export function bestPhone(...candidates: (string | null | undefined)[]): string | null {
  const phones = candidates.map(leadPhone).filter((p): p is string => Boolean(p))
  return phones.find((p) => phoneKind(p) === 'celular') ?? phones[0] ?? null
}
