// ============================================================
// Reading which conversation is open, as pure functions.
//
// Separated from content.js so it can be tested. This is the most
// fragile logic in the extension — it reads a page that belongs to
// somebody else and changes without notice — and also the logic whose
// failure is hardest to notice, because a wrong answer produces a
// panel that looks entirely normal while describing the wrong person.
//
// There are two sources, in this order:
//   1. WhatsApp's own code, asked through page-bridge.js
//      (`chatFromPage`). As of November 2026 it is the only one that works.
//   2. The `data-id` of the message rows (`chatFromDataIds`), which
//      used to carry the chat id. Kept for builds that still do.
//
// Loaded by content.js through a dynamic import (MV3 content scripts
// cannot themselves be modules, but they can import one that is
// listed in web_accessible_resources).
// ============================================================

/**
 * What WhatsApp's own code said about the open chat (the JSON string
 * page-bridge.js answers with), as one of:
 *
 *   { state: "none" }                  no chat is open
 *   { state: "other" }                 a group, channel or broadcast
 *   { state: "user", phone, lid }      a person; either may be null,
 *                                      never both
 *   null                               no usable answer — read the
 *                                      page instead
 *
 * The answer comes from a script that runs in the page's own world, so
 * it is exactly as trustworthy as the page: every field is checked
 * here, and anything that is not plainly a number is dropped rather
 * than passed along. A `lid` is NOT a phone number and is never
 * returned as one.
 */
export function chatFromPage(answer) {
  if (typeof answer !== "string" || !answer) return null;
  let payload;
  try {
    payload = JSON.parse(answer);
  } catch {
    return null;
  }
  if (!payload || payload.v !== 1 || payload.ready !== true) return null;

  const chat = payload.chat;
  if (chat === null) return { state: "none" };
  if (typeof chat !== "object" || typeof chat.server !== "string") return null;

  const phoneOf = (value) =>
    typeof value === "string" && /^\d{8,15}$/.test(value) ? value : null;

  if (chat.server === "c.us" || chat.server === "s.whatsapp.net") {
    const phone = phoneOf(chat.user);
    return phone ? { state: "user", phone, lid: null } : null;
  }
  if (chat.server === "lid") {
    if (typeof chat.user !== "string" || !/^\d{1,20}$/.test(chat.user)) return null;
    return { state: "user", phone: phoneOf(chat.phone), lid: chat.user };
  }
  // g.us, broadcast, newsletter and whatever comes next: not a
  // conversation with one person.
  return chat.server ? { state: "other" } : null;
}

/**
 * The number logged in to this WhatsApp Web, from the same answer as
 * `chatFromPage`: digits, or null when the answer has none or it is
 * not a phone number. Untrusted input like the rest of the answer.
 */
export function myPhoneFromPage(answer) {
  if (typeof answer !== "string" || !answer) return null;
  let payload;
  try {
    payload = JSON.parse(answer);
  } catch {
    return null;
  }
  if (!payload || payload.v !== 1 || payload.ready !== true) return null;
  const me = payload.me;
  return typeof me === "string" && /^\d{8,15}$/.test(me) ? me : null;
}

/**
 * The same answer, read from the `data-id` attributes of the message
 * rows — for WhatsApp builds that still put the chat id there.
 *
 * `null` when the rows say nothing, which is what current builds do
 * (November 2026): the caller then reports it could not identify the chat.
 */
export function chatFromDataIds(dataIds) {
  const identity = chatIdentityFromDataIds(dataIds);
  if (identity) {
    return { state: "user", phone: identity.phone ?? null, lid: identity.lid ?? null };
  }
  const collective = (dataIds ?? []).some(
    (raw) => typeof raw === "string" && /@(g\.us|broadcast|status|newsletter)(_|$)/.test(raw),
  );
  return collective ? { state: "other" } : null;
}

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
  return chatIdentityFromDataIds(dataIds)?.phone ?? null;
}

/**
 * Who the open 1:1 chat is with, as WhatsApp's own ids say:
 * `{ phone }`, `{ lid }`, or null.
 *
 * `lid` is the privacy-preserving id newer builds use for more and
 * more chats. It is NOT a phone number — its digits must never be
 * looked up or saved as one — but it is stable per person, which is
 * what lets the panel remember a contact the operator linked by hand.
 *
 * A phone id anywhere in the chat wins over a lid: it is the stronger
 * identity, and a chat caught mid-migration may carry both.
 */
export function chatIdentityFromDataIds(dataIds) {
  let lid = null;
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

    const digits = (user || "").replace(/\D/g, "");

    if (server === "lid") {
      // Only all-digit ids: anything else is a shape this doesn't know.
      if (!lid && digits && digits === user) lid = digits;
      continue;
    }
    if (server !== "c.us" && server !== "s.whatsapp.net") continue;

    // Shorter than 8 digits is not a reachable number anywhere; it is
    // a parse that went wrong.
    if (digits.length >= 8) return { phone: digits };
  }
  return lid ? { lid } : null;
}

/**
 * The phone number of the open chat, when its header shows one, or
 * null.
 *
 * For someone not in the phone's address book WhatsApp titles the chat
 * with the number itself, in international form ("+55 31 99999-8888").
 * In a lid chat that is the only place the number appears.
 *
 * Strict: the title must be nothing but a number with its `+`. If the
 * header has more than one such title and they disagree, there is no
 * telling which is the chat's, so the answer is null.
 */
export function phoneFromHeaderTitles(titles) {
  const found = new Set();
  for (const raw of titles ?? []) {
    const title = typeof raw === "string" ? raw.trim() : "";
    if (!/^\+[\d\s()‐-―.-]+$/.test(title)) continue;
    const digits = title.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) found.add(digits);
  }
  return found.size === 1 ? [...found][0] : null;
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
