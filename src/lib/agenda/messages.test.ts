import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import {
  countTemplateVariables,
  DEFAULT_CONFIRM_TEXT,
  DEFAULT_REMINDER_TEXT,
  messageVars,
  processCalendarNotifications,
  renderMessage,
  templateParams,
  type ClaimedNotification,
  type NotifyDeps,
} from './messages'

const ACC = 'acc-1'
const CONTACT = 'contact-1'

const vars = messageVars({
  contactName: 'Ana Paula Souza',
  calendarName: 'Dr. João',
  startsAt: '2030-01-07T17:30:00.000Z', // 14:30 in São Paulo
  timezone: 'America/Sao_Paulo',
})

describe('messageVars', () => {
  it('describes the appointment on the agenda’s clock, first name only', () => {
    expect(vars).toEqual({
      nome: 'Ana',
      agenda: 'Dr. João',
      dia: 'segunda-feira',
      data: '7 de janeiro',
      hora: '14:30',
    })
  })

  it('follows the agenda’s zone, not the server’s', () => {
    const manaus = messageVars({
      contactName: 'Ana',
      calendarName: 'Dr. João',
      startsAt: '2030-01-08T02:30:00.000Z',
      timezone: 'America/Manaus',
    })
    expect([manaus.dia, manaus.data, manaus.hora]).toEqual(['segunda-feira', '7 de janeiro', '22:30'])
  })
})

describe('renderMessage', () => {
  it('fills the default texts', () => {
    expect(renderMessage(DEFAULT_CONFIRM_TEXT, vars)).toBe(
      'Olá, Ana! Seu horário com Dr. João está marcado para segunda-feira, 7 de janeiro, às 14:30.',
    )
    expect(renderMessage(DEFAULT_REMINDER_TEXT, vars)).toBe(
      'Olá, Ana! Passando para lembrar do seu horário com Dr. João: segunda-feira, 7 de janeiro, às 14:30. Se não puder vir, é só avisar por aqui.',
    )
  })

  it('a contact without a name does not get "Olá, !"', () => {
    const anonymous = { ...vars, nome: '' }
    expect(renderMessage(DEFAULT_CONFIRM_TEXT, anonymous)).toMatch(/^Olá! Seu horário/)
    expect(renderMessage('{nome}, seu horário é às {hora}.', anonymous)).toBe(
      'Seu horário é às 14:30.',
    )
  })

  it('leaves braces that are not variables alone', () => {
    expect(renderMessage('Traga o {documento} às {hora}', vars)).toBe('Traga o {documento} às 14:30')
  })
})

describe('templates', () => {
  it('counts the body’s variables, each once', () => {
    expect(countTemplateVariables('Olá {{1}}, dia {{2}} às {{3}} com {{4}}. Até {{2}}!')).toBe(4)
    expect(countTemplateVariables('Sem variáveis')).toBe(0)
    expect(countTemplateVariables(null)).toBe(0)
  })

  it('sends first name, date, time and agenda, as many as the body takes', () => {
    expect(templateParams(vars, 4)).toEqual(['Ana', '7 de janeiro', '14:30', 'Dr. João'])
    expect(templateParams(vars, 2)).toEqual(['Ana', '7 de janeiro'])
    expect(templateParams(vars, 0)).toEqual([])
  })

  it('never sends an empty variable', () => {
    expect(templateParams({ ...vars, nome: '' }, 1)).toEqual(['cliente'])
  })
})

// ---------------------------------------------------------------------
// A small in-memory stand-in for the Supabase client, enough for the
// sender: filtered reads, updates, and an rpc that hands out `claims`.
// ---------------------------------------------------------------------

type Row = Record<string, unknown>

function fakeDb(
  tables: Record<string, Row[]>,
  claims: ClaimedNotification[],
  rpcError: { code: string } | null = null,
) {
  const rpcCalls: Row[] = []
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let patch: Row | null = null
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
    const result = () => {
      if (patch) {
        for (const r of rows()) Object.assign(r, patch)
        return { data: null, error: null }
      }
      return { data: rows(), error: null }
    }
    const q = {
      select: () => q,
      update: (values: Row) => ((patch = values), q),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      order: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    }
    return q
  }
  const rpc = async (_name: string, args: Row) => {
    rpcCalls.push(args)
    return rpcError ? { data: null, error: rpcError } : { data: claims, error: null }
  }
  return { db: { from, rpc } as unknown as SupabaseClient, rpcCalls }
}

describe('processCalendarNotifications', () => {
  const claim = (over: Partial<ClaimedNotification> = {}): ClaimedNotification => ({
    event_id: 'e1',
    notification: 'confirmation',
    account_id: ACC,
    contact_id: CONTACT,
    starts_at: '2030-01-07T17:30:00.000Z',
    calendar_name: 'Dr. João',
    timezone: 'America/Sao_Paulo',
    message_text: null,
    template_name: null,
    template_language: null,
    ...over,
  })
  const world = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
    contacts: [{ id: CONTACT, account_id: ACC, name: 'Ana Souza', phone: '5511900000001' }],
    conversations: [{ id: 'conv-1', account_id: ACC, contact_id: CONTACT }],
    calendar_events: [{ id: 'e1' }, { id: 'e2' }],
    message_templates: [
      {
        account_id: ACC,
        name: 'lembrete_consulta',
        language: 'pt_BR',
        body_text: 'Olá {{1}}, lembrete: {{2}} às {{3}}.',
      },
    ],
    ...over,
  })
  const deps = (provider: string | null = 'meta'): NotifyDeps => ({
    send: vi.fn(async () => ({ messageId: 'msg-1', whatsappMessageId: 'wamid' })),
    openConversation: vi.fn(async () => 'conv-new'),
    resolveProvider: vi.fn(async () => provider),
  })

  it('sends the default wording when the agenda wrote none', async () => {
    const d = deps()
    const { db } = fakeDb(world(), [claim(), claim({ event_id: 'e2', notification: 'reminder' })])
    expect(await processCalendarNotifications(db, null, d)).toEqual({ sent: 2, failed: 0 })
    expect(d.send).toHaveBeenNthCalledWith(1, expect.anything(), ACC, {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText:
        'Olá, Ana! Seu horário com Dr. João está marcado para segunda-feira, 7 de janeiro, às 14:30.',
    })
    expect(vi.mocked(d.send).mock.calls[1][2].contentText).toMatch(/^Olá, Ana! Passando para lembrar/)
  })

  it('sends the agenda’s own wording', async () => {
    const d = deps()
    const { db } = fakeDb(world(), [claim({ message_text: '{nome}, te esperamos às {hora}!' })])
    await processCalendarNotifications(db, null, d)
    expect(vi.mocked(d.send).mock.calls[0][2].contentText).toBe('Ana, te esperamos às 14:30!')
  })

  it('on the official API, a named template goes instead of the text', async () => {
    const d = deps('meta')
    const { db } = fakeDb(world(), [
      claim({ notification: 'reminder', template_name: 'lembrete_consulta', template_language: 'pt_BR' }),
    ])
    expect(await processCalendarNotifications(db, null, d)).toEqual({ sent: 1, failed: 0 })
    expect(d.send).toHaveBeenCalledWith(expect.anything(), ACC, {
      conversationId: 'conv-1',
      messageType: 'template',
      templateName: 'lembrete_consulta',
      templateLanguage: 'pt_BR',
      // The body has three variables, so the agenda's name is left out.
      templateParams: ['Ana', '7 de janeiro', '14:30'],
    })
  })

  it('off the official API there are no templates: the text goes', async () => {
    const d = deps('uazapi')
    const { db } = fakeDb(world(), [claim({ template_name: 'lembrete_consulta' })])
    await processCalendarNotifications(db, null, d)
    expect(vi.mocked(d.send).mock.calls[0][2].messageType).toBe('text')
  })

  it('a template that was deleted is recorded on the appointment, not sent blind', async () => {
    const d = deps('meta')
    const t = world()
    const { db } = fakeDb(t, [claim({ notification: 'reminder', template_name: 'sumiu' })])
    expect(await processCalendarNotifications(db, null, d)).toEqual({ sent: 0, failed: 1 })
    expect(d.send).not.toHaveBeenCalled()
    expect(t.calendar_events[0].reminder_error).toBe('O modelo "sumiu" não existe mais neste CRM.')
  })

  it('opens a conversation for a contact who never had one', async () => {
    const d = deps()
    const { db } = fakeDb(world({ conversations: [] }), [claim()])
    await processCalendarNotifications(db, null, d)
    expect(d.openConversation).toHaveBeenCalledWith(expect.anything(), ACC, '5511900000001')
    expect(vi.mocked(d.send).mock.calls[0][2].conversationId).toBe('conv-new')
  })

  it('records why a message did not go, and carries on with the next', async () => {
    const d = deps()
    vi.mocked(d.send).mockRejectedValueOnce(new Error('Fora da janela de 24 horas'))
    const t = world()
    const { db } = fakeDb(t, [claim(), claim({ event_id: 'e2', notification: 'reminder' })])
    expect(await processCalendarNotifications(db, null, d)).toEqual({ sent: 1, failed: 1 })
    expect(t.calendar_events[0].confirmation_error).toBe('Fora da janela de 24 horas')
    expect(t.calendar_events[1].reminder_error).toBeUndefined()
  })

  it('a contact without a phone fails with a reason', async () => {
    const d = deps()
    const t = world({ contacts: [{ id: CONTACT, account_id: ACC, name: 'Ana', phone: null }] })
    const { db } = fakeDb(t, [claim()])
    expect(await processCalendarNotifications(db, null, d)).toEqual({ sent: 0, failed: 1 })
    expect(t.calendar_events[0].confirmation_error).toBe('O contato não tem telefone no CRM.')
  })

  it('can be asked for one appointment only', async () => {
    const { db, rpcCalls } = fakeDb(world(), [])
    await processCalendarNotifications(db, 'e1', deps())
    expect(rpcCalls).toEqual([{ p_limit: 50, p_event_id: 'e1' }])
  })

  it('before migration 067 it quietly does nothing', async () => {
    const { db } = fakeDb(world(), [], { code: 'PGRST202' })
    expect(await processCalendarNotifications(db, null, deps())).toBeNull()
  })
})
