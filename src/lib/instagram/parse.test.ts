import { describe, expect, it } from 'vitest'

import { parseInstagramWebhook } from './parse'

function payload(messaging: unknown[], object = 'instagram') {
  return { object, entry: [{ id: 'biz-1', messaging }] }
}

const TEXT = {
  sender: { id: 'igsid-9' },
  recipient: { id: 'biz-1' },
  message: { mid: 'mid-1', text: 'oi, qual o preço?' },
}

describe('parseInstagramWebhook', () => {
  it('reads a plain text DM', () => {
    expect(parseInstagramWebhook(payload([TEXT]))).toEqual([
      {
        igUserId: 'biz-1',
        fromId: 'igsid-9',
        text: 'oi, qual o preço?',
        externalId: 'mid-1',
        attachmentOnly: false,
      },
    ])
  })

  it('DROPS our own echoed messages', () => {
    // The most important case in the file: Meta sends every outbound
    // message back. Ingesting those with an auto-reply agent on is an
    // agent talking to itself, billed per turn.
    const echo = {
      sender: { id: 'biz-1' },
      recipient: { id: 'igsid-9' },
      message: { mid: 'mid-2', text: 'Olá! Como posso ajudar?', is_echo: true },
    }
    expect(parseInstagramWebhook(payload([echo]))).toEqual([])
  })

  it('drops a message from the business even without the echo flag', () => {
    const unflagged = {
      sender: { id: 'biz-1' },
      recipient: { id: 'igsid-9' },
      message: { mid: 'mid-3', text: 'nossa resposta' },
    }
    expect(parseInstagramWebhook(payload([unflagged]))).toEqual([])
  })

  it('drops an unsent message', () => {
    const deleted = {
      sender: { id: 'igsid-9' },
      message: { mid: 'mid-4', text: 'apagada', is_deleted: true },
    }
    expect(parseInstagramWebhook(payload([deleted]))).toEqual([])
  })

  it('ignores reactions, reads and postbacks', () => {
    const noise = [
      { sender: { id: 'igsid-9' }, reaction: { emoji: '❤️' } },
      { sender: { id: 'igsid-9' }, read: { mid: 'mid-1' } },
      { sender: { id: 'igsid-9' }, postback: { title: 'Começar' } },
    ]
    expect(parseInstagramWebhook(payload(noise))).toEqual([])
  })

  it('describes an attachment-only DM instead of dropping it', () => {
    const image = {
      sender: { id: 'igsid-9' },
      message: { mid: 'mid-5', attachments: [{ type: 'image' }] },
    }
    const [msg] = parseInstagramWebhook(payload([image]))
    expect(msg).toMatchObject({ text: '[imagem]', attachmentOnly: true })
  })

  it('names a story mention, which is a different conversation opener', () => {
    const story = {
      sender: { id: 'igsid-9' },
      message: { mid: 'mid-6', attachments: [{ type: 'story_mention' }] },
    }
    expect(parseInstagramWebhook(payload([story]))[0]!.text).toBe(
      '[menção em story]',
    )
  })

  it('keeps the words when a DM has both text and an attachment', () => {
    const both = {
      sender: { id: 'igsid-9' },
      message: {
        mid: 'mid-7',
        text: 'esse aqui',
        attachments: [{ type: 'image' }],
      },
    }
    const [msg] = parseInstagramWebhook(payload([both]))
    expect(msg).toMatchObject({ text: 'esse aqui', attachmentOnly: false })
  })

  it('ignores payloads for other Meta products', () => {
    // leadgen and WhatsApp reach the same app.
    expect(parseInstagramWebhook(payload([TEXT], 'page'))).toEqual([])
    expect(parseInstagramWebhook(payload([TEXT], 'whatsapp_business_account'))).toEqual([])
  })

  it('reads several messages and several entries in one delivery', () => {
    const body = {
      object: 'instagram',
      entry: [
        { id: 'biz-1', messaging: [TEXT, { ...TEXT, message: { mid: 'm2', text: 'segunda' } }] },
        { id: 'biz-2', messaging: [{ sender: { id: 'igsid-x' }, message: { mid: 'm3', text: 'outra conta' } }] },
      ],
    }
    const out = parseInstagramWebhook(body)
    expect(out).toHaveLength(3)
    expect(out[2]).toMatchObject({ igUserId: 'biz-2', fromId: 'igsid-x' })
  })

  it('survives junk instead of throwing at the webhook boundary', () => {
    for (const junk of [null, undefined, 'texto', 42, {}, { object: 'instagram' }]) {
      expect(parseInstagramWebhook(junk)).toEqual([])
    }
    expect(parseInstagramWebhook({ object: 'instagram', entry: [{}] })).toEqual([])
    expect(
      parseInstagramWebhook(payload([{ sender: {}, message: { text: 'sem id' } }])),
    ).toEqual([])
  })

  it('keeps a message with no mid rather than losing it', () => {
    const noMid = { sender: { id: 'igsid-9' }, message: { text: 'sem mid' } }
    expect(parseInstagramWebhook(payload([noMid]))[0]).toMatchObject({
      externalId: null,
      text: 'sem mid',
    })
  })
})
