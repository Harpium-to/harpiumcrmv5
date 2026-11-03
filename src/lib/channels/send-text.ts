import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText } from '@/lib/flows/meta-send'
import { sendInstagramToConversation } from '@/lib/instagram/send'

// ============================================================
// One outbound text, on whichever channel the thread belongs to.
//
// Before Instagram there was nothing to decide: every channel was a
// WhatsApp channel, so the account's enabled provider settled it and
// `engineSendText` could be called directly. Instagram breaks that,
// because an account can run both at once and the channel is a
// property of the *thread*, not of the account.
//
// Without this, an agent answering an Instagram DM would call
// `engineSendText`, which looks up the contact's phone — empty, for
// someone who only ever wrote on Instagram — and throws. That is a
// safe failure rather than a message to a stranger's phone, but it is
// still an agent that cannot answer half the inbox.
//
// Same argument shape as `engineSendText` so the call sites are a
// one-line swap.
// ============================================================

export interface ChannelSendArgs {
  accountId: string
  /** Audit column on the persisted message row. Not a tenancy check. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the row as an AI reply so the inbox badges it. */
  aiGenerated?: boolean
}

/**
 * The channel a conversation belongs to.
 *
 * Defaults to WhatsApp on any doubt — a missing column (migration 047
 * unapplied), a missing row, a read error. Every thread that existed
 * before Instagram is a WhatsApp thread, so the safe default is also
 * the correct one for every row that has no answer.
 */
async function channelOf(conversationId: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('conversations')
      .select('channel')
      .eq('id', conversationId)
      .maybeSingle()
    if (error || !data) return 'whatsapp'
    return (data.channel as string | null) ?? 'whatsapp'
  } catch {
    return 'whatsapp'
  }
}

export async function sendChannelText(args: ChannelSendArgs): Promise<void> {
  const channel = await channelOf(args.conversationId)

  if (channel === 'instagram') {
    await sendInstagramToConversation(
      supabaseAdmin(),
      args.accountId,
      args.conversationId,
      args.text,
      { senderType: 'bot', aiGenerated: args.aiGenerated ?? false },
    )
    return
  }

  await engineSendText(args)
}
