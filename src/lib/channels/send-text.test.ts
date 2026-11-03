import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// Which door an outbound message leaves by.
//
// The failure this guards against is not a crash: it is answering an
// Instagram DM over WhatsApp, which means messaging a stranger's phone
// with a reply meant for someone else's inbox.
// ---------------------------------------------------------------------

const h = vi.hoisted(() => ({
  engineSendText: vi.fn(),
  sendInstagramToConversation: vi.fn(),
  channelRow: null as { channel: string | null } | null,
  readError: null as { message: string } | null,
  adminThrows: false,
}))

vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/instagram/send', () => ({
  sendInstagramToConversation: h.sendInstagramToConversation,
}))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    if (h.adminThrows) throw new Error('no service role key')
    return {
      from: () => {
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.eq = () => b
        b.maybeSingle = async () => ({ data: h.channelRow, error: h.readError })
        return b
      },
    }
  },
}))

import { sendChannelText } from './send-text'

const ARGS = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  text: 'olá',
  aiGenerated: true,
}

describe('sendChannelText', () => {
  beforeEach(() => {
    h.engineSendText.mockReset().mockResolvedValue({ whatsapp_message_id: 'm1' })
    h.sendInstagramToConversation
      .mockReset()
      .mockResolvedValue({ messageId: 'm2', externalId: 'ig-1' })
    h.channelRow = { channel: 'whatsapp' }
    h.readError = null
    h.adminThrows = false
  })

  it('sends a WhatsApp thread through the WhatsApp path', async () => {
    await sendChannelText(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(ARGS)
    expect(h.sendInstagramToConversation).not.toHaveBeenCalled()
  })

  it('sends an Instagram thread through Instagram, never WhatsApp', async () => {
    h.channelRow = { channel: 'instagram' }
    await sendChannelText(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendInstagramToConversation).toHaveBeenCalledTimes(1)
    const call = h.sendInstagramToConversation.mock.calls[0] as unknown[]
    expect(call[1]).toBe('acct-1')
    expect(call[2]).toBe('conv-1')
    expect(call[3]).toBe('olá')
  })

  it('marks a bot reply as a bot reply on Instagram too', async () => {
    h.channelRow = { channel: 'instagram' }
    await sendChannelText(ARGS)
    const call = h.sendInstagramToConversation.mock.calls[0] as unknown[]
    expect(call[4]).toEqual({ senderType: 'bot', aiGenerated: true })
  })

  it('falls back to WhatsApp when the channel column is not there yet', async () => {
    // Migration 047 unapplied: every existing thread is WhatsApp, so
    // the safe default is also the correct one.
    h.channelRow = null
    h.readError = { message: 'column conversations.channel does not exist' }
    await sendChannelText(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('falls back to WhatsApp on a null channel or a missing row', async () => {
    h.channelRow = { channel: null }
    await sendChannelText(ARGS)
    h.channelRow = null
    await sendChannelText(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
  })

  it('does not swallow a real send failure', async () => {
    // The channel lookup is allowed to fail softly. The send is not:
    // a reply that silently never left is how a customer waits all
    // afternoon for an answer the log says was delivered.
    h.engineSendText.mockRejectedValue(new Error('meta rejected'))
    await expect(sendChannelText(ARGS)).rejects.toThrow('meta rejected')

    h.channelRow = { channel: 'instagram' }
    h.sendInstagramToConversation.mockRejectedValue(new Error('fora da janela'))
    await expect(sendChannelText(ARGS)).rejects.toThrow('fora da janela')
  })

  it('still sends when the channel lookup itself blows up', async () => {
    h.adminThrows = true
    await sendChannelText(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })
})
