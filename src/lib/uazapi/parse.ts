// ============================================================
// UAZAPI inbound webhook parsing — pure, unit-tested.
//
// UAZAPI posts a FLAT body (no `{event, instance, data}` envelope):
// `EventType` at the top plus a single `message` object. We keep 1:1
// text messages and flatten them to the shape the ingest path consumes.
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

export interface UazapiInboundMessage {
  /** The other party's phone, digits only, e.g. "5511999998888". */
  counterpartPhone: string
  text: string
  externalId: string | null
  name: string | null
  /** true when the operator sent it from their own phone. */
  fromMe: boolean
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
 * Flatten a UAZAPI webhook body to an inbound message, or null when it
 * is not a 1:1 text we can ingest. Never throws.
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

  const text = str(message.text) ?? str(message.content)
  if (!text) return [] // media and other types — skipped for this cut

  return [
    {
      counterpartPhone,
      text,
      externalId: str(message.messageid) ?? str(message.id),
      // A name is only meaningful for the other party.
      name: fromMe ? null : str(message.senderName),
      fromMe,
    },
  ]
}
