// ============================================================
// Reading which conversation is open, as pure functions.
//
// Separated from content.js so it can be tested. This is the most
// fragile logic in the extension — it reads a DOM that belongs to
// somebody else and changes without notice — and also the logic whose
// failure is hardest to notice, because a wrong answer produces a
// panel that looks entirely normal while describing the wrong person.
//
// Loaded by content.js through a dynamic import (MV3 content scripts
// cannot themselves be modules, but they can import one that is
// listed in web_accessible_resources).
// ============================================================

/**
 * The phone digits of the open 1:1 chat, from the `data-id` attributes
 * of its message rows.
 *
 * WhatsApp's own ids look like `false_5511999999999@c.us_3EB0C7` —
 * the middle field is the JID, part of the protocol rather than the
 * styling, which is why this reads those instead of class names that
 * are regenerated every release.
 *
 * Returns null, never a guess, for: a group (`@g.us`), a broadcast or
 * status list, an id shape this does not recognise, or a number too
 * short to be real. The caller renders "abra uma conversa individual",
 * which is a far better outcome than one customer's record shown
 * beside another customer's chat.
 */
export function chatPhoneFromDataIds(dataIds) {
  for (const raw of dataIds ?? []) {
    const value = typeof raw === "string" ? raw : "";
    const parts = value.split("_");
    // `<fromMe>_<jid>_<messageId>`; some builds append a participant,
    // which is why this reads field 1 rather than splitting into 3.
    if (parts.length < 2) continue;
    const jid = parts[1];
    if (!jid || !jid.includes("@")) continue;

    const [user, server] = jid.split("@");

    // A group has no single contact; status and broadcast are not
    // conversations with a person at all.
    if (server === "g.us" || server === "broadcast" || server === "status")
      return null;
    // c.us is a phone contact; lid is the privacy-preserving id newer
    // builds use, which is NOT a phone number and must not be treated
    // as one.
    if (server !== "c.us" && server !== "s.whatsapp.net") continue;

    const digits = (user || "").replace(/\D/g, "");
    // Shorter than 8 digits is not a reachable number anywhere; it is
    // a parse that went wrong.
    if (digits.length >= 8) return digits;
  }
  return null;
}

/**
 * A usable display name from the chat header, or null.
 *
 * When the person is not in the phone's address book WhatsApp shows
 * the number itself as the title. Saving that produces a CRM contact
 * named "+55 11 99999-9999", which is worse than no name: it looks
 * filled in, so nobody ever fixes it.
 */
export function usableChatName(title) {
  const trimmed = (title ?? "").trim();
  if (!trimmed) return null;
  if (/^[\d\s+()‐-―.-]+$/.test(trimmed)) return null;
  return trimmed;
}
