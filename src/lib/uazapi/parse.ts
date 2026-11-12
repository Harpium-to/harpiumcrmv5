// ============================================================
// UAZAPI inbound webhook parsing — pure, unit-tested.
//
// UAZAPI posts a FLAT body (no `{event, instance, data}` envelope):
// `EventType` at the top plus a single `message` object. We keep 1:1
// messages — text, media and button/list taps (D1) — and flatten them
// to the shape the ingest path consumes. The media file itself is not
// in the webhook: ingest downloads it by message id.
//
// Both directions are kept, and that is on purpose. We configure the
// gateway with `excludeMessages: ['wasSentByApi']`, so the echo of our
// own sends never arrives — but a reply the operator types on their
// phone does, carrying `fromMe: true`. Those belong in the thread as
// agent messages, otherwise the CRM shows a half conversation.
//
// For a `fromMe` message the counterpart is the CHAT, not the sender;
// picking the right JID per direction is the whole subtlety here.
// ============================================================

export type UazapiInboundMediaKind = 'image' | 'video' | 'audio' | 'document'

export interface UazapiInboundMessage {
  /** The other party's phone, digits only, e.g. "5511999998888". */
  counterpartPhone: string
  /** The other party's LID (digits), when the payload carries it. */
  counterpartLid: string | null
  /** The text, the media caption, or the label of the tapped option. '' for media without a caption. */
  text: string
  externalId: string | null
  name: string | null
  /** true when the operator sent it from their own phone. */
  fromMe: boolean
  /** Set for photos, videos, audio, voice notes, documents and stickers (as images). */
  mediaKind: UazapiInboundMediaKind | null
  /** The id of the button or list row the customer tapped (D1). Flows match on it. */
  interactiveReplyId: string | null
  /** When it was sent (ISO), from `messageTimestamp`; used when importing history. */
  sentAt: string | null
}

/** `messageTimestamp` is milliseconds; older payloads used seconds. */
function timestampIso(v: unknown): string | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const ms = n < 1e12 ? n * 1000 : n
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Our media kind for a UAZAPI `messageType` ("ImageMessage",
 * "AudioMessage", "DocumentWithCaptionMessage"…). Matched by substring:
 * the names are WhatsApp's protobuf types and new variants keep the
 * same stems. Stickers are images; video notes ("ptv") are videos.
 */
export function mediaKindOf(messageType: string | null): UazapiInboundMediaKind | null {
  const t = (messageType ?? '').toLowerCase()
  if (!t) return null
  if (t.includes('sticker') || t.includes('image')) return 'image'
  if (t.includes('video') || t.includes('ptv')) return 'video'
  if (t.includes('audio') || t.includes('ptt')) return 'audio'
  if (t.includes('document')) return 'document'
  return null
}

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : null
  }
  return null
}

function jidDigits(jid: string): string {
  return jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? ''
}

/**
 * Extract the phone (digits) from a WhatsApp JID, or null for groups,
 * channels and LIDs. A LID ("123456789012345@lid") is WhatsApp's
 * private id for an account, not a number: saving it as a phone made
 * a contact "+20066104033409" that no reply could reach.
 */
function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null
  if (jid.includes('@g.us') || jid.includes('@newsletter') || jid.includes('@lid')) return null
  const digits = jidDigits(jid)
  return digits.length >= 8 ? digits : null
}

/** The digits of a LID JID, or null when `jid` isn't one. */
function lidFromJid(jid: string | null): string | null {
  if (!jid || !jid.includes('@lid')) return null
  const digits = jidDigits(jid)
  return digits.length >= 8 ? digits : null
}

function firstOf<T>(values: (string | null)[], pick: (v: string | null) => T | null): T | null {
  for (const v of values) {
    const hit = pick(v)
    if (hit) return hit
  }
  return null
}

/**
 * Flatten a UAZAPI webhook body to inbound messages — empty when it is
 * not a 1:1 message we can show (groups, reactions, our own echo,
 * other events). Never throws.
 */
export function parseUazapiInbound(payload: unknown): UazapiInboundMessage[] {
  if (!isDict(payload)) return []

  const eventType = str(payload.EventType) ?? str(payload.eventType)
  if (eventType && eventType !== 'messages') return []

  const message = payload.message
  if (!isDict(message)) return []

  if (message.isGroup === true) return []

  const fromMe = message.fromMe === true

  // Our own API echo should already be filtered at the gateway; drop it
  // here too so a mis-set webhook can't double-insert.
  if (message.wasSentByApi === true) return []

  // In a 1:1 chat the counterpart is the chat itself, both directions.
  // UAZAPI keeps `chatid` on the number (@s.whatsapp.net) even when
  // WhatsApp addresses the chat by LID — the LID goes to `chatlid` /
  // `sender_lid`, and `sender` may be the LID. So: chatid first, then
  // the sender's resolved number, never a LID as a phone.
  const chatid = str(message.chatid)
  const phoneCandidates = fromMe
    ? [chatid]
    : [chatid, str(message.sender_pn), str(message.sender)]
  const counterpartPhone = firstOf(phoneCandidates, phoneFromJid)
  if (!counterpartPhone) return []

  // The LID too, when known: a contact saved earlier under it gets its
  // real number back (see inbound.ts).
  const lidCandidates = fromMe
    ? [str(message.chatlid), chatid]
    : [str(message.sender_lid), str(message.chatlid), str(message.sender), chatid]
  const counterpartLid = firstOf(lidCandidates, lidFromJid)

  // A reaction is state on another message, not a message of its own.
  if (str(message.reaction)) return []

  const interactiveReplyId = str(message.buttonOrListid)
  const mediaKind = interactiveReplyId ? null : mediaKindOf(str(message.messageType))
  // `content` is the raw payload; only a plain string is text.
  const text =
    str(message.text) ?? (typeof message.content === 'string' ? str(message.content) : null)

  // Something we can show: text, media (caption optional), or a tap.
  if (!text && !mediaKind && !interactiveReplyId) return []

  return [
    {
      counterpartPhone,
      counterpartLid,
      text: text ?? (interactiveReplyId ?? ''),
      externalId: str(message.messageid) ?? str(message.id),
      // A name is only meaningful for the other party.
      name: fromMe ? null : str(message.senderName),
      fromMe,
      mediaKind,
      interactiveReplyId,
      sentAt: timestampIso(message.messageTimestamp),
    },
  ]
}

export interface UazapiConnectionEvent {
  /** disconnected | connecting | connected | hibernated */
  status: string
  /** UAZAPI's reason, e.g. "TemporaryBan" or the last disconnect reason. */
  reason: string | null
}

/**
 * The instance's connection changed (EventType `connection`). The
 * phone going offline for days, a logout on the phone, or a ban all
 * arrive here, and the agency console needs to know without anyone
 * opening the QR screen. null for any other event.
 */
export function parseUazapiConnection(payload: unknown): UazapiConnectionEvent | null {
  if (!isDict(payload)) return null
  const eventType = str(payload.EventType) ?? str(payload.eventType)
  if (eventType !== 'connection') return null
  const instance = isDict(payload.instance) ? payload.instance : {}
  const status = str(instance.status)
  if (!status) return null
  return {
    status,
    reason: str(payload.type) ?? str(instance.lastDisconnectReason),
  }
}
