import { describe, expect, it } from 'vitest'

import { fakeDb, type Row } from './fake-db.test-helper'
import { ingestLead, reprocessLead } from './ingest'
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

describe('ingestLead — Harpium Lead v1 from the quiz', () => {
  it('creates the contact and writes tags, custom field and note', async () => {
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

    expect(t.contact_custom_values).toEqual([
      expect.objectContaining({ contact_id: r.contactId, custom_field_id: 'cf-fat', value: '75a150' }),
    ])

    expect(t.contact_notes).toHaveLength(1)
    const note = String(t.contact_notes[0].note_text)
    expect(note).toContain('• Maior desafio: Só pedem preço')
    expect(note).toContain('• uf: TO')
    expect(note).toContain('• ticket_medio: 40a80')
    expect(note).not.toContain('faturamento')
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
    expect(note).toContain('• obs_interna: ligar depois')
    expect(note).not.toContain('lixo')
  })

  it('refuses a custom field id from another account', async () => {
    const t = world({ custom_fields: [] })
    const raw = { nome: 'Caio', telefone: '11988887777', verba: '5 mil' }
    await ingestLead(fakeDb(t), ACC, normalizeLead(raw), raw, { mappings: { verba: 'custom:foreign' } })
    expect(t.contact_custom_values).toHaveLength(0)
    expect(String(t.contact_notes[0].note_text)).toContain('• verba: 5 mil')
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

  it('only backfills an existing contact', async () => {
    const raw = quiz()
    const t = world({
      contacts: [{ id: 'c1', account_id: ACC.id, phone: '+5563999990000', phone_normalized: '5563999990000', name: 'Ana', company: 'Nova Empresa', city: null }],
    })
    await reprocessLead(fakeDb(t), ACC, { id: 'old', raw, contact_id: 'c1', created_at: '2026-11-01T00:00:00Z' })
    expect(t.contacts[0]).toMatchObject({ company: 'Nova Empresa', city: 'Palmas' })
  })
})
