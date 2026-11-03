// ============================================================
// Reading Meta's Instagram messaging webhook.
//
// Pure: payload in, messages out. No database, no network — which is
// what lets the awkward cases below be tests instead of things
// discovered in production at 2am.
//
// Shape (object: "instagram"):
//   entry[].id                     the business's IG account id
//   entry[].messaging[].sender.id  the IGSID of whoever wrote
//   entry[].messaging[].message    { mid, text?, attachments?, is_echo? }
// ============================================================

export interface InstagramInboundMessage {
  /** The business account the DM arrived at — resolves the workspace. */
  igUserId: string
  /** Instagram-scoped id of the person who wrote. The de-dup key. */
  fromId: string
  /** Message text, or a stand-in describing an attachment. */
  text: string
  /** Meta's message id, for de-duplicating retries. */
  externalId: string | null
  /** True when the payload only described attachments, no words. */
  attachmentOnly: boolean
}

interface RawMessaging {
  sender?: { id?: string }
  recipient?: { id?: string }
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    attachments?: Array<{ type?: string }>
  }
  // Reactions, read receipts and postbacks also arrive on this array.
  reaction?: unknown
  read?: unknown
  postback?: unknown
}

interface RawPayload {
  object?: string
  entry?: Array<{ id?: string; messaging?: RawMessaging[] }>
}

/** A short stand-in so an image-only DM still shows up in the inbox. */
function describeAttachments(types: string[]): string {
  if (types.length === 0) return '[anexo]'
  const label: Record<string, string> = {
    image: 'imagem',
    video: 'vídeo',
    audio: 'áudio',
    file: 'arquivo',
    share: 'publicação compartilhada',
    story_mention: 'menção em story',
    ig_reel: 'reel',
  }
  const named = types.map((t) => label[t] ?? t)
  return `[${named.join(', ')}]`
}

/**
 * Every real inbound message in a webhook payload.
 *
 * What gets dropped, and why each one matters:
 *
 *   is_echo      Meta sends our own outbound messages back to us. Ingest
 *                those and every reply becomes a new inbound message —
 *                which, with an auto-reply agent switched on, is an
 *                agent in a conversation with itself, billed per turn.
 *                This is the single most important line in the file.
 *   is_deleted   The person unsent it. Storing it would make the CRM
 *                the one place the message still exists.
 *   reaction /
 *   read /
 *   postback     Not messages. They carry no `message` object and would
 *                otherwise land as empty rows.
 *   object       Payloads for other Meta products reach the same app;
 *                only `instagram` belongs here.
 */
export function parseInstagramWebhook(
  payload: unknown,
): InstagramInboundMessage[] {
  const body = (payload ?? {}) as RawPayload
  if (body.object !== 'instagram') return []

  const out: InstagramInboundMessage[] = []

  for (const entry of body.entry ?? []) {
    const igUserId = entry.id?.trim()
    if (!igUserId) continue

    for (const event of entry.messaging ?? []) {
      const message = event.message
      if (!message) continue
      if (message.is_echo === true) continue
      if (message.is_deleted === true) continue

      const fromId = event.sender?.id?.trim()
      if (!fromId) continue
      // A message whose sender is the business itself is an echo that
      // forgot its flag. Seen in the wild; cheap to defend against.
      if (fromId === igUserId) continue

      const text = message.text?.trim() ?? ''
      const types = (message.attachments ?? [])
        .map((a) => a.type?.trim() ?? '')
        .filter(Boolean)

      if (!text && types.length === 0) continue

      out.push({
        igUserId,
        fromId,
        text: text || describeAttachments(types),
        externalId: message.mid?.trim() || null,
        attachmentOnly: !text,
      })
    }
  }

  return out
}
