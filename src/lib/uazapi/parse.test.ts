import { describe, it, expect } from 'vitest'

import { parseUazapiInbound } from './parse'

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
      },
    ])
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

  it('drops groups, newsletters and non-text', () => {
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
