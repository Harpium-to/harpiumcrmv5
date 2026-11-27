import { describe, expect, it } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'
import type { IngestOptions } from '@/lib/leads/ingest'
import type { NormalizedLead } from '@/lib/leads/parse'

import { createCallList, importResults, ImportError, parseImportInput, type ImportDeps } from './import'
import type { ExtractionRow } from './store'

const ACC = 'acc-1'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const extraction = {
  id: 'ex-1',
  account_id: ACC,
  name: 'Dentistas Goiânia',
  source: 'cnpj',
  filters: { tipo: 'todos', cnaes: ['8630504'], rotulos: { cnaes: ['Atividade odontológica'] } },
} as unknown as ExtractionRow

const result = (n: number, over: Row = {}): Row => ({
  id: id(n),
  account_id: ACC,
  extraction_id: 'ex-1',
  source: 'cnpj',
  external_key: `${n}`.padStart(14, '0'),
  kind: 'empresa',
  name: `Empresa ${n}`,
  phone: `+55629999900${String(n).padStart(2, '0')}`,
  phone_normalized: `55629999900${String(n).padStart(2, '0')}`,
  extras: {},
  status: 'novo',
  imported_at: null,
  created_at: '2026-11-17T12:00:00Z',
  ...over,
})

function setup(rows: Row[], extra: Partial<Record<string, Row[]>> = {}) {
  const t = {
    lead_extraction_results: rows,
    contacts: [],
    prospecting_blocklist: [],
    lead_field_mappings: [],
    contact_tasks: [],
    ...extra,
  } as Record<string, Row[]>
  const calls: { lead: NormalizedLead; payload: Record<string, unknown>; options?: IngestOptions }[] = []
  const deps: ImportDeps = {
    ingest: async (_admin, _account, lead, raw, options) => {
      calls.push({ lead, payload: raw as Record<string, unknown>, options })
      const existing = t.contacts.find((c) => c.phone_normalized === lead.phone?.replace(/\D/g, ''))
      return {
        leadId: `lead-${calls.length}`,
        contactId: (existing?.id as string) ?? `contact-${calls.length}`,
        contactCreated: !existing,
        contactStatus: existing ? 'atualizado' : 'criado',
        duplicate: false,
      }
    },
  }
  return { t, calls, deps }
}

const account = { id: ACC, ownerUserId: 'owner' }

describe('parseImportInput', () => {
  it('needs rows, at most a batch, and a list name', () => {
    expect(parseImportInput({ result_ids: [id(1), id(1), 'x'], list_name: ' Dentistas  nov ' })).toEqual({
      resultIds: [id(1)],
      listName: 'Dentistas nov',
      completeExisting: false,
    })
    expect(() => parseImportInput({ result_ids: [], list_name: 'x y' })).toThrow(ImportError)
    expect(() => parseImportInput({ result_ids: [id(1)], list_name: 'x' })).toThrow('nome')
    expect(() =>
      parseImportInput({ result_ids: Array.from({ length: 26 }, (_, i) => id(i + 1)), list_name: 'Lista' }),
    ).toThrow('25')
  })
})

describe('importResults', () => {
  it('writes new leads silently: no card, the list tag, the origin', async () => {
    const { t, calls, deps } = setup([result(1), result(2)])
    const out = await importResults(fakeDb(t), account, extraction, { resultIds: [id(1), id(2)], listName: 'Dentistas nov', completeExisting: false }, deps)
    expect(out).toMatchObject({ imported: 2, created: 2, completed: 0 })
    expect(calls[0].options).toMatchObject({ skipDeal: true, patchMode: 'replace' })
    expect(calls[0].lead.origin).toBe('Extrator · CNPJ')
    expect(calls[0].lead.tags).toEqual(['extrator', 'Dentistas nov'])
    expect(t.lead_extraction_results[0]).toMatchObject({ contact_id: 'contact-1', lead_id: 'lead-1' })
    expect(t.lead_extraction_results[0].imported_at).toBeTruthy()
  })

  it('leaves out who has no phone, who is blocked now, and who was sent already', async () => {
    const { t, calls, deps } = setup(
      [result(1, { phone: null, phone_normalized: null }), result(2), result(3, { imported_at: '2026-11-17T12:30:00Z' })],
      { prospecting_blocklist: [{ account_id: ACC, phone_normalized: '5562999990002' }] },
    )
    const out = await importResults(fakeDb(t), account, extraction, { resultIds: [id(1), id(2), id(3)], listName: 'Lista', completeExisting: false }, deps)
    expect(calls).toHaveLength(0)
    expect(out.skipped).toMatchObject({ semTelefone: 1, bloqueado: 1, jaEnviado: 1 })
    expect(t.lead_extraction_results[1].status).toBe('bloqueado')
  })

  it('does not touch a contact that already exists, unless asked to complete it', async () => {
    const contacts = [{ id: 'c-9', account_id: ACC, phone: '+5562999990001', phone_normalized: '5562999990001' }]
    const left = setup([result(1)], { contacts })
    const skipped = await importResults(fakeDb(left.t), account, extraction, { resultIds: [id(1)], listName: 'Lista', completeExisting: false }, left.deps)
    expect(skipped.skipped.contato).toBe(1)
    expect(left.calls).toHaveLength(0)
    expect(left.t.lead_extraction_results[0]).toMatchObject({ status: 'contato', matched_contact_id: 'c-9' })

    const filled = setup([result(1)], { contacts })
    const done = await importResults(fakeDb(filled.t), account, extraction, { resultIds: [id(1)], listName: 'Lista', completeExisting: true }, filled.deps)
    expect(done).toMatchObject({ imported: 1, completed: 1, created: 0 })
    // Only empty data is filled, and the contact does not join the cold list.
    expect(filled.calls[0].options).toMatchObject({ patchMode: 'backfill', skipDeal: true })
    expect(filled.calls[0].lead.tags).toEqual([])
  })
})

describe('createCallList', () => {
  it('one task per lead in the CRM, never twice', async () => {
    const rows = [
      result(1, { imported_at: '2026-11-17T12:30:00Z', contact_id: 'c-1' }),
      result(2, { imported_at: '2026-11-17T12:30:00Z', contact_id: 'c-2' }),
      result(3),
    ]
    const { t } = setup(rows)
    expect(await createCallList(fakeDb(t), ACC, 'ex-1', 'u-1', 'u-1', null)).toEqual({ created: 2, already: 0 })
    expect(t.contact_tasks.map((x) => x.title)).toEqual(['Ligar para Empresa 1', 'Ligar para Empresa 2'])
    expect(await createCallList(fakeDb(t), ACC, 'ex-1', 'u-1', 'u-1', null)).toEqual({ created: 0, already: 2 })
  })
})
