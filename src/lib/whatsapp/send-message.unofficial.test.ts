import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------
// The inbox / public-API send core on the unofficial path (D1): it must
// hand the message to the QR-code sender, never touch Meta, and refuse
// what only exists on the official path.
// ---------------------------------------------------------------------

const h = vi.hoisted(() => ({
  provider: 'uazapi' as 'meta' | 'uazapi' | 'evolution' | null,
  sendUnofficial: vi.fn(),
  metaCalled: vi.fn(),
}))

vi.mock('@/lib/channels/whatsapp-route', () => ({
  NOT_CONNECTED_UNOFFICIAL: 'não conectado',
  resolveWhatsAppProvider: async () => h.provider,
}))
vi.mock('@/lib/channels/unofficial-send', async (orig) => ({
  ...(await orig<typeof import('@/lib/channels/unofficial-send')>()),
  sendUnofficialToConversation: h.sendUnofficial,
}))
vi.mock('@/lib/whatsapp/meta-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp/meta-api')>()),
  sendTextMessage: h.metaCalled,
  sendTemplateMessage: h.metaCalled,
  sendMediaMessage: h.metaCalled,
  sendInteractiveButtons: h.metaCalled,
  sendInteractiveList: h.metaCalled,
}))

import { sendMessageToConversation, SendMessageError } from './send-message'
import { UnofficialSendError } from '@/lib/channels/unofficial-send'

const db = {} as never

describe('sendMessageToConversation on the unofficial path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.provider = 'uazapi'
    h.sendUnofficial.mockResolvedValue({ messageId: 'msg-1', externalId: 'WA1' })
  })

  it('hands a voice note to the QR-code sender as a person’s message', async () => {
    const r = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'audio',
      mediaUrl: 'https://cdn/v.ogg',
      replyToMessageId: 'parent',
    })
    expect(r).toEqual({ messageId: 'msg-1', whatsappMessageId: 'WA1' })
    expect(h.sendUnofficial).toHaveBeenCalledWith(db, {
      provider: 'uazapi',
      accountId: 'acct-1',
      conversationId: 'conv-1',
      content: { kind: 'media', mediaKind: 'audio', url: 'https://cdn/v.ogg', caption: null, filename: null },
      senderType: 'agent',
      replyToMessageId: 'parent',
    })
    expect(h.metaCalled).not.toHaveBeenCalled()
  })

  it('refuses templates, which only exist on the official path', async () => {
    const err = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'template',
      templateName: 'boas_vindas',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(SendMessageError)
    expect(err).toMatchObject({ code: 'template_requires_official', status: 400 })
    expect(h.sendUnofficial).not.toHaveBeenCalled()
  })

  it('on the unofficial path with nothing connected, refuses instead of using Meta', async () => {
    h.provider = null
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'oi',
      }),
    ).rejects.toMatchObject({ code: 'whatsapp_not_configured' })
    expect(h.metaCalled).not.toHaveBeenCalled()
  })

  it('keeps the sender’s refusal and maps gateway failures to 502', async () => {
    h.sendUnofficial.mockRejectedValueOnce(
      new UnofficialSendError('O canal Evolution envia só texto.', 'unsupported', 400),
    )
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'image',
        mediaUrl: 'https://cdn/a.jpg',
      }),
    ).rejects.toMatchObject({ code: 'unsupported', status: 400 })

    h.sendUnofficial.mockRejectedValueOnce(new Error('Falha ao enviar: HTTP 500'))
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'oi',
      }),
    ).rejects.toMatchObject({ code: 'provider_error', status: 502 })
  })
})
