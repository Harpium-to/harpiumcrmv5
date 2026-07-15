import { describe, it, expect } from 'vitest'
import { parseEvolutionInbound } from './parse'

describe('parseEvolutionInbound', () => {
  it('parses a simple text message (conversation)', () => {
    const r = parseEvolutionInbound({
      event: 'messages.upsert',
      instance: 'inst',
      data: {
        key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'A1' },
        pushName: 'Ana',
        message: { conversation: 'olá' },
      },
    })
    expect(r).toEqual([
      { fromPhone: '5511999998888', text: 'olá', externalId: 'A1', name: 'Ana' },
    ])
  })

  it('parses extendedTextMessage and an array of data', () => {
    const r = parseEvolutionInbound({
      event: 'messages.upsert',
      data: [
        {
          key: { remoteJid: '5521988887777@s.whatsapp.net', fromMe: false, id: 'B1' },
          message: { extendedTextMessage: { text: 'quero saber o preço' } },
        },
      ],
    })
    expect(r[0].fromPhone).toBe('5521988887777')
    expect(r[0].text).toBe('quero saber o preço')
  })

  it('ignores outbound echoes, groups, and non-text', () => {
    expect(
      parseEvolutionInbound({
        data: { key: { remoteJid: '55119@s.whatsapp.net', fromMe: true }, message: { conversation: 'x' } },
      }),
    ).toEqual([])
    expect(
      parseEvolutionInbound({
        data: { key: { remoteJid: '123456@g.us', fromMe: false }, message: { conversation: 'oi grupo' } },
      }),
    ).toEqual([])
    expect(
      parseEvolutionInbound({
        data: { key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false }, message: { imageMessage: {} } },
      }),
    ).toEqual([])
  })

  it('ignores non-upsert events and junk', () => {
    expect(parseEvolutionInbound({ event: 'connection.update', data: {} })).toEqual([])
    expect(parseEvolutionInbound(null)).toEqual([])
    expect(parseEvolutionInbound('nope')).toEqual([])
  })
})
