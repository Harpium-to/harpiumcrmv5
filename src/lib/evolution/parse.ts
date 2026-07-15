// ============================================================
// Evolution API inbound webhook parsing — pure, unit-tested.
//
// Evolution posts `messages.upsert` events. `data` may be a single
// message object or an array. We keep only inbound (fromMe === false)
// text messages from 1:1 chats (skip groups and non-text for this first
// cut) and flatten them to a simple shape the ingest path consumes.
// ============================================================

export interface EvolutionInboundMessage {
  fromPhone: string // digits only, e.g. "5511999998888"
  text: string
  externalId: string | null
  name: string | null
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
  if (jid.includes('@g.us')) return null // group chat — skip
  const digits = jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? ''
  return digits.length >= 8 ? digits : null
}

function textFromMessage(message: unknown): string | null {
  if (!isDict(message)) return null
  const conv = str(message.conversation)
  if (conv) return conv
  const ext = message.extendedTextMessage
  if (isDict(ext)) return str(ext.text)
  return null
}

function parseOne(data: unknown): EvolutionInboundMessage | null {
  if (!isDict(data)) return null
  const key = isDict(data.key) ? data.key : {}
  if (key.fromMe === true) return null // outbound echo — ignore

  const fromPhone = phoneFromJid(str(key.remoteJid))
  if (!fromPhone) return null

  const text = textFromMessage(data.message)
  if (!text) return null // non-text (media/etc.) — skip for now

  return {
    fromPhone,
    text,
    externalId: str(key.id),
    name: str(data.pushName),
  }
}

/**
 * Flatten an Evolution webhook body to inbound text messages. Accepts
 * either `data` as an object or an array; ignores non-`messages.upsert`
 * events. Never throws.
 */
export function parseEvolutionInbound(payload: unknown): EvolutionInboundMessage[] {
  if (!isDict(payload)) return []
  const event = str(payload.event)
  if (event && event !== 'messages.upsert') return []

  const data = payload.data
  const items = Array.isArray(data) ? data : [data]
  const out: EvolutionInboundMessage[] = []
  for (const item of items) {
    const parsed = parseOne(item)
    if (parsed) out.push(parsed)
  }
  return out
}
