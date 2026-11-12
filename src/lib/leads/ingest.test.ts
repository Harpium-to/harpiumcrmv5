import { describe, expect, it } from 'vitest'

import { fakeDb, type Row } from './fake-db.test-helper'
import { ingestLead, MAX_NEW_FIELDS_PER_LEAD, reprocessLead } from './ingest'
import { noteMarker } from './note'
import { normalizeLead } from './parse'

const ACC = { id: 'acc-1', ownerUserId: 'owner-1' }

const quiz = (over: Record<string, unknown> = {}) => ({
  versao: '1',
  origem: 'quiz-planejados',
  id_externo: 'sessao-7f3c',
  contato: { nome: 'Ana', telefone: '+5563999990000', empresa: 'Planejados Silva', cidade: 'Palmas', uf: 'TO' },
  qualificacao: { rota: 'A', qualificado: true },
  etiquetas: ['quiz-planejados', 'verba-baixa'],
  respostas: [{ pergunta: 'Maior desafio', resposta: 'Só pedem preço' }],
  campos: { faturamento: '75a150', ticket_medio: '40a80' },
  ...over,
})

function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    contacts: [],
    leads: [],
    tags: [{ id: 'tag-old', account_id: ACC.id, name: 'Verba-Baixa' }],
    contact_tags: [],
    custom_fields: [{ id: 'cf-fat', account_id: ACC.id, field_name: 'Faturamento' }],
    contact_custom_values: [],
    contact_notes: [],
    ...over,
  }
}

/** The contact's custom values, by field name. */
function valuesOf(t: Record<string, Row[]>, contactId: string): Record<string, string> {
  const name = new Map(t.custom_fields.map((f) => [f.id, String(f.field_name)]))
  const out: Record<string, string> = {}
  for (const v of t.contact_custom_values) {
    if (v.contact_id === contactId) out[name.get(String(v.custom_field_id)) ?? '?'] = String(v.value)
  }
  return out
}

describe('ingestLead — Harpium Lead v1 from the quiz', () => {
  it('creates the contact and writes tags, custom fields and note', async () => {
    const t = world()
    const db = fakeDb(t)
    const raw = quiz()
    const r = await ingestLead(db, ACC, normalizeLead(raw), raw)

    expect(r).toMatchObject({ contactCreated: true, contactStatus: 'criado', duplicate: false })
    expect(t.contacts).toHaveLength(1)
    expect(t.contacts[0]).toMatchObject({
      phone: '+5563999990000',
      name: 'Ana',
      company: 'Planejados Silva',
      city: 'Palmas',
      source: 'quiz-planejados',
      user_id: 'owner-1',
    })
    expect(t.leads).toHaveLength(1)
    expect(t.leads[0]).toMatchObject({ source: 'quiz-planejados', external_id: 'sessao-7f3c', raw })

    // Existing tag matched case-insensitively; the others created.
    const names = t.tags.map((x) => x.name).sort()
    expect(names).toEqual(['Verba-Baixa', 'quiz-planejados', 'rota-a'])
    expect(t.contact_tags).toHaveLength(3)

    // Every piece of the lead in a field of its own: the existing
    // "Faturamento", and new ones for the rest (named after the key or
    // the question, marked as created by a lead).
    expect(valuesOf(t, String(r.contactId))).toEqual({
      Faturamento: '75a150',
      UF: 'TO',
      'Ticket medio': '40a80',
      'Maior desafio': 'Só pedem preço',
      Rota: 'A',
    })
    expect(t.custom_fields.find((f) => f.field_name === 'Maior desafio')).toMatchObject({
      account_id: ACC.id,
      user_id: 'owner-1',
      field_type: 'text',
      field_key: 'maior_desafio',
      created_from: 'lead',
    })

    // The note stays as the lead's history; fields that found a home
    // are no longer repeated under "Outros dados".
    expect(t.contact_notes).toHaveLength(1)
    const note = String(t.contact_notes[0].note_text)
    expect(note).toContain('• Maior desafio: Só pedem preço')
    expect(note).not.toContain('Outros dados')
    expect(note).toContain(noteMarker(r.leadId))
  })

  it('a second quiz from the same phone updates the contact and adds to the history', async () => {
    const t = world()
    const db = fakeDb(t)
    const first = quiz()
    await ingestLead(db, ACC, normalizeLead(first), first)
    const second = quiz({
      id_externo: 'sessao-2',
      contato: { nome: 'Ana Paula', telefone: '63 9999-0000', empresa: '', cidade: 'Araguaína' },
    })
    const r = await ingestLead(db, ACC, normalizeLead(second), second)

    expect(r).toMatchObject({ contactCreated: false, contactStatus: 'atualizado' })
    expect(t.contacts).toHaveLength(1)
    expect(t.leads).toHaveLength(2)
    // A typed name stays; an empty company erases nothing; a new city replaces.
    expect(t.contacts[0]).toMatchObject({ name: 'Ana', company: 'Planejados Silva', city: 'Araguaína' })
    expect(t.contact_notes).toHaveLength(2)
    // The fields were reused, not created twice.
    expect(t.custom_fields.filter((f) => f.field_name === 'Maior desafio')).toHaveLength(1)
  })

  it('a newer lead replaces a field value; an existing field matches without accents or case', async () => {
    const t = world({
      custom_fields: [{ id: 'cf-desafio', account_id: ACC.id, field_name: 'MAIOR DESAFIO' }],
    })
    const db = fakeDb(t)
    const first = quiz()
    const r = await ingestLead(db, ACC, normalizeLead(first), first)
    const second = quiz({
      id_externo: 'sessao-2',
      respostas: [{ pergunta: 'Maior desafío', resposta: 'Falta de leads' }],
    })
    await ingestLead(db, ACC, normalizeLead(second), second)
    expect(valuesOf(t, String(r.contactId))['MAIOR DESAFIO']).toBe('Falta de leads')
    expect(t.custom_fields.filter((f) => /desaf/i.test(String(f.field_name)))).toHaveLength(1)
  })

  it('the same id_externo within 24 h is not written twice', async () => {
    const t = world()
    const db = fakeDb(t)
    const raw = quiz()
    const a = await ingestLead(db, ACC, normalizeLead(raw), raw)
    const b = await ingestLead(db, ACC, normalizeLead(raw), raw)
    expect(b).toMatchObject({ duplicate: true, leadId: a.leadId, contactId: a.contactId })
    expect(t.leads).toHaveLength(1)
    expect(t.contact_notes).toHaveLength(1)
  })

  it('replaces a placeholder name (the phone) with the real one', async () => {
    const t = world({
      contacts: [
        { id: 'c1', account_id: ACC.id, phone: '5563999990000', phone_normalized: '5563999990000', name: '5563999990000' },
      ],
    })
    const raw = quiz()
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
    expect(t.contacts).toHaveLength(1)
    expect(t.contacts[0].name).toBe('Ana')
  })
})

describe('ingestLead — leads without a phone', () => {
  it('attaches to an existing contact with the same e-mail', async () => {
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5511900000000', phone_normalized: '5511900000000', name: 'Bia', email: 'Bia@Ex.com' }],
    })
    const raw = { nome: 'Bia', email: 'bia@ex.com', empresa: 'Loja' }
    const r = await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
    expect(r).toMatchObject({ contactId: 'c1', contactStatus: 'atualizado' })
    expect(t.contacts[0].company).toBe('Loja')
  })

  it('keeps the lead without a contact when nothing matches', async () => {
    const t = world()
    const raw = { nome: 'Sem Fone', email: 'novo@ex.com' }
    const r = await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
    expect(r).toMatchObject({ contactId: null, contactStatus: null })
    expect(t.leads).toHaveLength(1)
    expect(t.contacts).toHaveLength(0)
  })
})

describe('ingestLead — de/para mappings', () => {
  it('sends a field to a contact column, a custom field, the note or nowhere', async () => {
    const t = world({ custom_fields: [{ id: 'cf-x', account_id: ACC.id, field_name: 'Investimento' }] })
    const raw = {
      nome: 'Caio',
      telefone: '11988887777',
      site_da_empresa: 'caio.com',
      verba: '5 mil',
      lixo: 'x',
      obs_interna: 'ligar depois',
    }
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw, {
      mappings: {
        site_da_empresa: 'contact:website',
        verba: 'custom:cf-x',
        lixo: 'ignore',
        obs_interna: 'note',
      },
    })
    expect(t.contacts[0].website).toBe('caio.com')
    expect(t.contact_custom_values).toEqual([
      expect.objectContaining({ custom_field_id: 'cf-x', value: '5 mil' }),
    ])
    const note = String(t.contact_notes[0].note_text)
    expect(note).toContain('• Obs interna: ligar depois')
    expect(note).not.toContain('lixo')
    // Nothing mapped elsewhere became a field.
    expect(t.custom_fields.map((f) => f.field_name)).toEqual(['Investimento'])
  })

  it('refuses a custom field id from another account', async () => {
    const t = world({ custom_fields: [] })
    const raw = { nome: 'Caio', telefone: '11988887777', verba: '5 mil' }
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw, { mappings: { verba: 'custom:foreign' } })
    // The foreign id is never written; the account gets its own field.
    expect(t.contact_custom_values.map((v) => v.custom_field_id)).not.toContain('foreign')
    expect(valuesOf(t, String(t.contacts[0].id))).toEqual({ Verba: '5 mil' })
  })

  it('maps an answer (not only a field) on the de/para', async () => {
    const t = world()
    const raw = quiz({ campos: {} })
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw, {
      mappings: { maior_desafio: 'ignore', rota: 'ignore' },
    })
    const values = valuesOf(t, String(t.contacts[0].id))
    expect(values).toEqual({ UF: 'TO' })
  })
})

describe('ingestLead — fields a lead creates', () => {
  const many = (n: number) => {
    const raw: Record<string, string> = { nome: 'Rui', telefone: '11977776666' }
    for (let i = 0; i < n; i++) raw[`pergunta_${i}`] = `r${i}`
    return raw
  }

  it("fills the account's own Empresa / Cidade fields, but never creates them", async () => {
    const withFields = world({
      custom_fields: [
        { id: 'cf-emp', account_id: ACC.id, field_name: 'Empresa' },
        { id: 'cf-cid', account_id: ACC.id, field_name: 'cidade' },
      ],
    })
    const raw = quiz({ campos: {}, respostas: [] })
    await ingestLead(fakeDb(withFields), ACC, normalizeLead(raw), raw)
    const values = valuesOf(withFields, String(withFields.contacts[0].id))
    expect(values).toMatchObject({ Empresa: 'Planejados Silva', cidade: 'Palmas' })
    // The details stay on the contact as well.
    expect(withFields.contacts[0]).toMatchObject({ company: 'Planejados Silva', city: 'Palmas' })

    const without = world({ custom_fields: [] })
    await ingestLead(fakeDb(without), ACC, normalizeLead(raw), raw)
    expect(without.custom_fields.map((f) => f.field_name)).not.toContain('Empresa')
    expect(without.custom_fields.map((f) => f.field_name)).not.toContain('Cidade')
  })

  it('keeps filling a field a lead created after someone renamed it', async () => {
    const t = world({
      custom_fields: [
        { id: 'cf-renamed', account_id: ACC.id, field_name: 'Desafio', field_key: 'maior_desafio', created_from: 'lead' },
      ],
    })
    const raw = quiz({ campos: {} })
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
    expect(valuesOf(t, String(t.contacts[0].id)).Desafio).toBe('Só pedem preço')
    expect(t.custom_fields.filter((f) => /desafio/i.test(String(f.field_name)))).toHaveLength(1)
  })

  it(`creates at most ${MAX_NEW_FIELDS_PER_LEAD} fields per lead; the rest goes to the note`, async () => {
    const t = world({ custom_fields: [] })
    const raw = many(MAX_NEW_FIELDS_PER_LEAD + 3)
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
    expect(t.custom_fields).toHaveLength(MAX_NEW_FIELDS_PER_LEAD)
    const note = String(t.contact_notes[0].note_text)
    expect(note).toContain(`• Pergunta ${MAX_NEW_FIELDS_PER_LEAD + 2}: r${MAX_NEW_FIELDS_PER_LEAD + 2}`)
  })

  it('stops creating fields once leads made 200 in the account', async () => {
    const existing = Array.from({ length: 200 }, (_, i) => ({
      id: `cf-${i}`,
      account_id: ACC.id,
      field_name: `Antigo ${i}`,
      created_from: 'lead',
    }))
    const t = world({ custom_fields: existing })
    const raw = many(2)
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw)
    expect(t.custom_fields).toHaveLength(200)
    expect(String(t.contact_notes[0].note_text)).toContain('• Pergunta 1: r1')
  })

  it('reuses the field another lead created a moment ago (unique key refused the twin)', async () => {
    const t = world({
      custom_fields: [],
    })
    const base = fakeDb(t)
    // The twin lands between our read and our insert.
    const db = {
      from(table: string) {
        const q = base.from(table) as unknown as Record<string, unknown>
        if (table !== 'custom_fields') return q
        const insert = q.insert as (r: Row) => unknown
        q.insert = (row: Row) => {
          if (!row.field_key) return insert(row)
          t.custom_fields.push({ id: 'cf-twin', account_id: ACC.id, field_name: row.field_name, field_key: row.field_key, created_from: 'lead' })
          return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }
        }
        return q
      },
    } as unknown as typeof base
    const raw = { nome: 'Rui', telefone: '11977776666', verba: '5 mil' }
    await ingestLead(db, ACC, normalizeLead(raw), raw)
    expect(t.custom_fields).toHaveLength(1)
    expect(t.contact_custom_values).toEqual([expect.objectContaining({ custom_field_id: 'cf-twin', value: '5 mil' })])
  })

  it('still creates the field before migration 070 (no field_key / created_from columns)', async () => {
    const t = world({ custom_fields: [] })
    const base = fakeDb(t)
    const db = {
      from(table: string) {
        const q = base.from(table) as unknown as Record<string, unknown>
        if (table !== 'custom_fields') return q
        const insert = q.insert as (r: Row) => unknown
        q.insert = (row: Row) =>
          'field_key' in row
            ? { select: () => ({ single: async () => ({ data: null, error: { code: 'PGRST204', message: "Could not find the 'created_from' column" } }) }) }
            : insert(row)
        return q
      },
    } as unknown as typeof base
    const raw = { nome: 'Rui', telefone: '11977776666', verba: '5 mil' }
    await ingestLead(db, ACC, normalizeLead(raw), raw)
    expect(t.custom_fields).toEqual([expect.objectContaining({ field_name: 'Verba', field_type: 'text' })])
    expect(t.custom_fields[0]).not.toHaveProperty('field_key')
    expect(valuesOf(t, String(t.contacts[0].id))).toEqual({ Verba: '5 mil' })
  })
})

describe('reprocessLead', () => {
  it('gives an old quiz lead its contact and note, once', async () => {
    const raw = quiz()
    const t = world({
      leads: [{ id: 'old-1', account_id: ACC.id, source: 'other', raw, contact_id: null, created_at: '2026-11-10T12:00:00Z' }],
    })
    const db = fakeDb(t)
    const stored = { id: 'old-1', raw, contact_id: null, created_at: '2026-11-10T12:00:00Z' }
    const r1 = await reprocessLead(db, ACC, stored)
    expect(r1.contactStatus).toBe('criado')
    expect(t.leads[0]).toMatchObject({ source: 'quiz-planejados', contact_id: r1.contactId, full_name: 'Ana' })

    await reprocessLead(db, ACC, { ...stored, contact_id: r1.contactId })
    expect(t.contacts).toHaveLength(1)
    expect(t.contact_notes).toHaveLength(1)
    expect(t.contact_tags).toHaveLength(3)
  })

  it('fills empty fields but never replaces a value someone typed', async () => {
    const raw = quiz()
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana' }],
      contact_custom_values: [{ id: 'v1', contact_id: 'c1', custom_field_id: 'cf-fat', value: '150+' }],
    })
    await reprocessLead(fakeDb(t), ACC, { id: 'old', raw, contact_id: 'c1', created_at: '2026-11-01T00:00:00Z' })
    const values = valuesOf(t, 'c1')
    expect(values.Faturamento).toBe('150+')
    expect(values['Maior desafio']).toBe('Só pedem preço')
  })

  it('only backfills an existing contact', async () => {
    const raw = quiz()
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana', company: 'Nova Empresa', city: null }],
    })
    await reprocessLead(fakeDb(t), ACC, { id: 'old', raw, contact_id: 'c1', created_at: '2026-11-01T00:00:00Z' })
    expect(t.contacts[0]).toMatchObject({ company: 'Nova Empresa', city: 'Palmas' })
  })
})
