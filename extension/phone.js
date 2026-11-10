// ============================================================
// When two phone numbers are the same person, as pure functions.
//
// A copy of `equivalentPhoneKeys` in src/lib/whatsapp/phone-utils.ts.
// The CRM already filters by it (`GET /api/v1/contacts?phone=`); the
// service worker applies it again to what comes back, so a CRM that
// ignored the filter — an older deploy — still can't put a stranger's
// record beside the chat. phone.test.js keeps the two copies equal.
// ============================================================

/** Digits only. */
export function phoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Every digits-only form under which the same phone may be stored, the
 * number itself first.
 *
 * The only alternative today is the Brazilian ninth digit: WhatsApp
 * still identifies many mobiles by their old 8-digit form
 * (`553199998888`) while the customer — and so the CRM — writes them
 * with the 9 (`5531999998888`), or the other way around. Mobiles only
 * (the 8-digit part starts with 6–9), so a landline is never paired
 * with a mobile.
 */
export function equivalentPhoneKeys(phone) {
  const digits = phoneDigits(phone);
  if (!digits) return [];
  const keys = [digits];
  const withNine = /^55([1-9]{2})9([6-9]\d{7})$/.exec(digits);
  if (withNine) keys.push(`55${withNine[1]}${withNine[2]}`);
  const withoutNine = /^55([1-9]{2})([6-9]\d{7})$/.exec(digits);
  if (withoutNine) keys.push(`55${withoutNine[1]}9${withoutNine[2]}`);
  return keys;
}

/** True when `a` and `b` are the same number, by the rule above. */
export function samePhone(a, b) {
  const other = phoneDigits(b);
  return other !== "" && equivalentPhoneKeys(a).includes(other);
}
