import { randomUUID } from 'node:crypto'

import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// ============================================================
// A customer message that arrived on the unofficial path, handed to
// the same machinery the Meta webhook drives (D1): flows first, then
// automations, then the AI, then the public `message.received` event.
//
// The order and the rules are the Meta webhook's (processMessage in
// src/app/api/whatsapp/webhook/route.ts) — keep the two in step:
//   - a flow that consumes the message (advanced a run, or started
//     one) suppresses the content triggers (new message, keyword,
//     button tap), because the customer is navigating the bot;
//   - "who is writing" triggers (new contact, first message) fire
//     regardless;
//   - the AI answers only plain text no flow took.
//
// Called only for messages from the customer (not what the operator
// typed on the phone) and only when the CRM sends through this same
// connection — otherwise the reply would leave from another number.
// Never throws: by now the message is stored, and a failing bot must
// not lose it.
// ============================================================

export interface InboundForEngines {
  accountId: string
  /** Sender-of-record for rows the engines create (NOT NULL user_id). */
  ownerUserId: string
  contactId: string
  conversationId: string
  /** The gateway's message id. */
  externalId: string | null
  /** Text, caption, or the tapped option's label. */
  text: string
  interactiveReplyId: string | null
  contentType: string
  isFirstInbound: boolean
  contactCreated: boolean
}

export async function dispatchInboundToEngines(m: InboundForEngines): Promise<void> {
  // The flows runner de-duplicates on this id; one that is missing
  // must not collide with every other message that lacks one.
  const messageKey = m.externalId ?? `sem-id-${randomUUID()}`

  let flowConsumed = false
  try {
    const flow = await dispatchInboundToFlows({
      accountId: m.accountId,
      userId: m.ownerUserId,
      contactId: m.contactId,
      conversationId: m.conversationId,
      message: m.interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: m.interactiveReplyId,
            reply_title: m.text,
            meta_message_id: messageKey,
          }
        : { kind: 'text', text: m.text, meta_message_id: messageKey },
      isFirstInboundMessage: m.isFirstInbound,
    })
    flowConsumed = flow.consumed
  } catch (err) {
    console.error('[inbound-dispatch] flows failed:', err)
  }

  const triggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  if (m.contactCreated) triggers.push('new_contact_created')
  if (m.isFirstInbound) triggers.push('first_inbound_message')
  if (!flowConsumed) {
    triggers.push('new_message_received', 'keyword_match')
    if (m.interactiveReplyId) triggers.push('interactive_reply')
  }
  await Promise.all(
    triggers.map((triggerType) =>
      runAutomationsForTrigger({
        accountId: m.accountId,
        triggerType,
        contactId: m.contactId,
        context: {
          message_text: m.text,
          conversation_id: m.conversationId,
          interactive_reply_id: m.interactiveReplyId ?? undefined,
        },
      }).catch((err) => console.error('[inbound-dispatch] automations failed:', err)),
    ),
  )

  if (!flowConsumed && !m.interactiveReplyId && m.text.trim()) {
    try {
      await dispatchInboundToAiReply({
        accountId: m.accountId,
        conversationId: m.conversationId,
        contactId: m.contactId,
        configOwnerUserId: m.ownerUserId,
      })
    } catch (err) {
      console.error('[inbound-dispatch] AI reply failed:', err)
    }
  }

  await dispatchWebhookEvent(supabaseAdmin(), m.accountId, 'message.received', {
    conversation_id: m.conversationId,
    contact_id: m.contactId,
    whatsapp_message_id: m.externalId,
    content_type: m.contentType,
    text: m.text,
  })
}
