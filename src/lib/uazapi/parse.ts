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

/** Extract the phone (digits) from a WhatsApp JID, or null for groups. */
function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null
  if (jid.includes('@g.us') || jid.includes('@newsletter')) return null
  const digits = jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? ''
  return digits.length >= 8 ? digits : null
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

  // Outbound: the counterpart is the chat. Inbound: it is the sender.
  const jid = fromMe
    ? (str(message.chatid) ?? str(message.sender))
    : (str(message.sender) ?? str(message.sender_pn) ?? str(message.chatid))

  const counterpartPhone = phoneFromJid(jid)
  if (!counterpartPhone) return []

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
      text: text ?? (interactiveReplyId ?? ''),
      externalId: str(message.messageid) ?? str(message.id),
      // A name is only meaningful for the other party.
      name: fromMe ? null : str(message.senderName),
      fromMe,
      mediaKind,
      interactiveReplyId,
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
