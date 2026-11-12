import { describe, it, expect } from 'vitest'
import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'
import { buildConversationContext, messageText, templatePreview } from './context'

/**
 * `messages` rows as the database returns them: newest first
 * (created_at DESC). The fake ignores order(), so the fixture is
 * written in that order already.
 */
function db(messages: Row[], extra: Record<string, Row[]> = {}) {
  return fakeDb({
    messages: messages.map((m) => ({ conversation_id: 'conv-1', content_type: 'text', ...m })),
    conversations: [{ id: 'conv-1', account_id: 'acc-1' }],
    message_templates: [],
    ...extra,
  })
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    const out = await buildConversationContext(
      db([
        { sender_type: 'customer', content_text: 'third' },
        { sender_type: 'agent', content_text: 'second' },
        { sender_type: 'customer', content_text: 'first' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      db([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      db([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('reads a greeting sent as a template, and buttons, but not media', async () => {
    const out = await buildConversationContext(
      db(
        [
          { sender_type: 'customer', content_type: 'image', content_text: null },
          { sender_type: 'customer', content_type: 'interactive', content_text: 'Quero agendar' },
          {
            sender_type: 'bot',
            content_type: 'interactive',
            content_text: null,
            interactive_payload: { kind: 'buttons', body: 'Prefere manhã ou tarde?' },
          },
          { sender_type: 'bot', content_type: 'template', content_text: null, template_name: 'boas_vindas' },
        ],
        {
          message_templates: [
            { account_id: 'acc-1', name: 'boas_vindas', body_text: 'Oi {{1}}, tudo bem? Aqui é da Planejados Silva.' },
            { account_id: 'acc-2', name: 'boas_vindas', body_text: 'De outra conta' },
          ],
        },
      ),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'assistant', content: 'Oi …, tudo bem? Aqui é da Planejados Silva.' },
      { role: 'assistant', content: 'Prefere manhã ou tarde?' },
      { role: 'user', content: 'Quero agendar' },
    ])
  })
})

describe('messageText', () => {
  it('names a template it cannot find', () => {
    expect(
      messageText({ sender_type: 'bot', content_type: 'template', content_text: null, template_name: 'x' }),
    ).toBe('[modelo de mensagem "x"]')
  })

  it('prefers the stored text', () => {
    expect(
      messageText(
        { sender_type: 'bot', content_type: 'template', content_text: 'Olá Ana', template_name: 'x' },
        new Map([['x', 'Olá {{1}}']]),
      ),
    ).toBe('Olá Ana')
  })

  it('templatePreview hides the placeholders', () => {
    expect(templatePreview('Olá {{1}}, seu horário é {{ 2 }}.')).toBe('Olá …, seu horário é ….')
  })
})
