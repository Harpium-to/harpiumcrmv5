import { describe, it, expect } from 'vitest'

import { mediaKindOf, parseUazapiConnection, parseUazapiInbound } from './parse'

const inbound = {
  EventType: 'messages',
  owner: '5511999999999',
  token: 'INSTANCE_TOKEN',
  instanceName: 'Atendimento',
  message: {
    id: '5511999999999:MSG1',
    messageid: 'MSG1',
    chatid: '5511888888888@s.whatsapp.net',
    sender: '5511888888888@s.whatsapp.net',
    senderName: 'Maria',
    fromMe: false,
    isGroup: false,
    messageType: 'Conversation',
    text: 'Olá, preciso de ajuda.',
    messageTimestamp: 1788868800000,
  },
}

describe('parseUazapiInbound', () => {
  it('flattens an inbound 1:1 text', () => {
    expect(parseUazapiInbound(inbound)).toEqual([
      {
        counterpartPhone: '5511888888888',
        text: 'Olá, preciso de ajuda.',
        externalId: 'MSG1',
        name: 'Maria',
        fromMe: false,
        mediaKind: null,
        interactiveReplyId: null,
      },
    ])
  })

  it('keeps media, with the caption as text or none at all', () => {
    const [photo] = parseUazapiInbound({
      ...inbound,
      message: { ...inbound.message, messageType: 'ImageMessage', text: 'olha o modelo' },
    })
    expect(photo).toMatchObject({ mediaKind: 'image', text: 'olha o modelo', externalId: 'MSG1' })

    const [voice] = parseUazapiInbound({
      ...inbound,
      message: { ...inbound.message, messageType: 'AudioMessage', text: '', content: { seconds: 4 } },
    })
    expect(voice).toMatchObject({ mediaKind: 'audio', text: '' })
  })

  it('keeps the id of a tapped button or list row', () => {
    const [tap] = parseUazapiInbound({
      ...inbound,
      message: {
        ...inbound.message,
        messageType: 'ButtonsResponseMessage',
        text: 'Manhã',
        buttonOrListid: 'manha',
      },
    })
    expect(tap).toMatchObject({ interactiveReplyId: 'manha', text: 'Manhã', mediaKind: null })
  })

  it('drops reactions', () => {
    expect(
      parseUazapiInbound({
        ...inbound,
        message: { ...inbound.message, messageType: 'ReactionMessage', text: '👍', reaction: 'MSG0' },
      }),
    ).toEqual([])
  })

  it('uses the chat (not the sender) as counterpart when fromMe', () => {
    const out = parseUazapiInbound({
      ...inbound,
      message: {
        ...inbound.message,
        fromMe: true,
        sender: '5511999999999@s.whatsapp.net',
        text: 'Já estou vendo!',
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0].counterpartPhone).toBe('5511888888888')
    expect(out[0].fromMe).toBe(true)
    expect(out[0].name).toBeNull()
  })

  it('drops our own API echo', () => {
    expect(
      parseUazapiInbound({
        ...inbound,
        message: { ...inbound.message, fromMe: true, wasSentByApi: true },
      }),
    ).toEqual([])
  })

  it('drops groups, newsletters and messages with nothing to show', () => {
    expect(
      parseUazapiInbound({ ...inbound, message: { ...inbound.message, isGroup: true } }),
    ).toEqual([])
    expect(
      parseUazapiInbound({
        ...inbound,
        message: { ...inbound.message, chatid: '123@g.us', sender: '123@g.us' },
      }),
    ).toEqual([])
    expect(
      parseUazapiInbound({ ...inbound, message: { ...inbound.message, text: '  ' } }),
    ).toEqual([])
  })

  it('ignores other event types and malformed bodies', () => {
    expect(parseUazapiInbound({ ...inbound, EventType: 'connection' })).toEqual([])
    expect(parseUazapiInbound(null)).toEqual([])
    expect(parseUazapiInbound({ EventType: 'messages' })).toEqual([])
  })
})

describe('mediaKindOf', () => {
  it('maps WhatsApp message types to ours', () => {
    expect(mediaKindOf('ImageMessage')).toBe('image')
    expect(mediaKindOf('StickerMessage')).toBe('image')
    expect(mediaKindOf('VideoMessage')).toBe('video')
    expect(mediaKindOf('AudioMessage')).toBe('audio')
    expect(mediaKindOf('DocumentWithCaptionMessage')).toBe('document')
    expect(mediaKindOf('ExtendedTextMessage')).toBeNull()
    expect(mediaKindOf('Conversation')).toBeNull()
    expect(mediaKindOf(null)).toBeNull()
  })
})

describe('parseUazapiConnection', () => {
  it('reads the new state and why it changed', () => {
    expect(
      parseUazapiConnection({
        EventType: 'connection',
        type: 'TemporaryBan',
        instance: { status: 'disconnected', lastDisconnectReason: 'unknown' },
      }),
    ).toEqual({ status: 'disconnected', reason: 'TemporaryBan' })
    expect(
      parseUazapiConnection({ EventType: 'connection', instance: { status: 'connected' } }),
    ).toEqual({ status: 'connected', reason: null })
  })

  it('is null for anything else', () => {
    expect(parseUazapiConnection({ EventType: 'messages', instance: { status: 'x' } })).toBeNull()
    expect(parseUazapiConnection({ EventType: 'connection' })).toBeNull()
    expect(parseUazapiConnection('x')).toBeNull()
  })
})
