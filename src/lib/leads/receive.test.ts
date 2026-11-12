import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { fakeDb, type Row } from './fake-db.test-helper'

let tables: Record<string, Row[]> = {}

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => fakeDb(tables),
}))

const { handleLeadIngest } = await import('./receive')

const TOKEN = 'tok-quiz'

function world(): Record<string, Row[]> {
  return {
    lead_ingest: [{ account_id: 'acc-1', token: TOKEN, google_key: 'gk' }],
    accounts: [{ id: 'acc-1', owner_user_id: 'owner-1' }],
    contacts: [],
    leads: [],
    tags: [],
    contact_tags: [],
    custom_fields: [],
    contact_custom_values: [],
    contact_notes: [],
  }
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://crm.test/api/leads/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

const quiz = JSON.stringify({
  versao: '1',
  origem: 'quiz-planejados',
  id_externo: 's-1',
  contato: { nome: 'Ana', telefone: '+5563999990000' },
  etiquetas: ['quiz-planejados'],
})

beforeEach(() => {
  tables = world()
  __resetRateLimitForTests()
})

describe('handleLeadIngest', () => {
  it('writes the lead and says what it did', async () => {
    const res = await handleLeadIngest(post(quiz), TOKEN)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, contato: 'criado' })
    expect(body.contato_id).toBe(tables.contacts[0].id)
    expect(body.contact_id).toBe(body.contato_id)
    expect(body.lead_id).toBe(tables.leads[0].id)
  })

  it('answers a repeat with duplicado: true', async () => {
    await handleLeadIngest(post(quiz), TOKEN)
    const res = await handleLeadIngest(post(quiz), TOKEN)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, duplicado: true, contato: 'atualizado' })
    expect(tables.leads).toHaveLength(1)
  })

  it('accepts the token in Authorization: Bearer', async () => {
    const res = await handleLeadIngest(post(quiz, { authorization: `Bearer ${TOKEN}` }), null)
    expect(res.status).toBe(200)
  })

  it('accepts a url-encoded form', async () => {
    const res = await handleLeadIngest(
      post('nome=Bia&telefone=11988887777&faturamento=50+mil', {
        'content-type': 'application/x-www-form-urlencoded',
      }),
      TOKEN,
    )
    expect(res.status).toBe(200)
    expect(tables.contacts[0]).toMatchObject({ name: 'Bia', phone: '+5511988887777' })
    expect(String(tables.contact_notes[0].note_text)).toContain('• faturamento: 50 mil')
  })

  it('401 for a wrong or missing token', async () => {
    expect((await handleLeadIngest(post(quiz), 'nope')).status).toBe(401)
    const res = await handleLeadIngest(post(quiz), null)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, erro: 'token_invalido' })
  })

  it('400 for an unreadable body', async () => {
    const res = await handleLeadIngest(post('{quebrado'), TOKEN)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, erro: 'formato_invalido' })
  })

  it('422 without phone and e-mail, but the lead is kept', async () => {
    const res = await handleLeadIngest(post(JSON.stringify({ versao: '1', contato: { nome: 'X' } })), TOKEN)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, erro: 'telefone_ou_email_obrigatorio' })
    expect(tables.leads).toHaveLength(1)
    expect(body.lead_id).toBe(tables.leads[0].id)
  })

  it('401 when a Google delivery has the wrong key, and never stores the key', async () => {
    const google = (key: string) =>
      JSON.stringify({
        google_key: key,
        lead_id: 'g1',
        user_column_data: [{ column_id: 'PHONE_NUMBER', string_value: '+5511999998888' }],
      })
    const bad = await handleLeadIngest(post(google('errada')), TOKEN)
    expect(bad.status).toBe(401)
    expect(await bad.json()).toEqual({ ok: false, erro: 'chave_google_invalida' })

    const ok = await handleLeadIngest(post(google('gk')), TOKEN)
    expect(ok.status).toBe(200)
    expect(tables.leads[0].raw).not.toHaveProperty('google_key')
  })

  it('429 after 60 deliveries in a minute', async () => {
    for (let i = 0; i < 60; i++) {
      await handleLeadIngest(post('{quebrado'), TOKEN)
    }
    const res = await handleLeadIngest(post(quiz), TOKEN)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
  })
})
