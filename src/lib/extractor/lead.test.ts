import { describe, expect, it } from 'vitest'

import { normalizeLead } from '@/lib/leads/parse'

import { RESULT_EXPORT_COLUMNS } from './export'
import { buildLeadPayload, leadFields } from './lead'
import type { ResultRow } from './store'

const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  id: 'r1',
  extraction_id: 'e1',
  source: 'cnpj',
  external_key: '12345678000190',
  kind: 'empresa',
  name: 'Clinica Sorriso',
  phone: '+5562999998888',
  phone_normalized: '5562999998888',
  phone_kind: 'celular',
  has_whatsapp: true,
  email: 'contato@sorriso.com.br',
  website: null,
  instagram: null,
  address: 'Avenida T 63, 1234',
  district: 'Setor Bueno',
  city: 'Goiania',
  uf: 'GO',
  cep: '74230100',
  activity: 'Atividade odontológica',
  extras: { cnpj: '12.345.678/0001-90', porte: 'Microempresa', abertura: '2019-03-05', capital: 50000, responsavel: 'Ana Souza' },
  status: 'novo',
  matched_contact_id: null,
  contact_id: null,
  lead_id: null,
  imported_at: null,
  enriched_at: null,
  created_at: '2026-11-17T12:00:00.000Z',
  ...over,
})

const ctx = {
  extractionId: 'e1',
  extractionName: 'Dentistas Goiânia',
  listName: 'Dentistas Goiânia nov/26',
  search: 'Atividade odontológica · Goiânia/GO',
  extractedAt: '2026-11-17T12:00:00.000Z',
}

describe('an extracted row as a lead', () => {
  it('carries the origin, the list tag and the extra data as fields', () => {
    const payload = buildLeadPayload(row(), ctx)
    expect(payload).toMatchObject({
      versao: '1',
      origem: 'Extrator · CNPJ',
      id_externo: 'e1:12345678000190',
      contato: { nome: 'Clinica Sorriso', telefone: '+5562999998888', cidade: 'Goiania', uf: 'GO' },
      etiquetas: ['extrator', 'Dentistas Goiânia nov/26'],
      campos: {
        CNPJ: '12.345.678/0001-90',
        Atividade: 'Atividade odontológica',
        Porte: 'Microempresa',
        'Data de abertura': '05/03/2019',
        Responsável: 'Ana Souza',
      },
    })
    expect(String(payload.nota)).toContain('Busca: Atividade odontológica · Goiânia/GO')
  })

  it('is read by the CRM\'s own receiver, with the origin as the source', () => {
    const lead = normalizeLead(buildLeadPayload(row(), ctx))
    expect(lead.source).toBe('extrator-cnpj')
    expect(lead.origin).toBe('Extrator · CNPJ')
    expect(lead.phone).toBe('+5562999998888')
    expect(lead.tags).toContain('extrator')
    expect(lead.externalId).toBe('e1:12345678000190')
    expect(normalizeLead(buildLeadPayload(row({ source: 'google_maps' }), ctx)).source).toBe('extrator-google-maps')
  })

  it('marks a MEI as personal data, in the tags and in the note', () => {
    const payload = buildLeadPayload(row({ kind: 'pessoa' }), ctx)
    expect(payload.etiquetas).toContain('dado-pessoal')
    expect(String(payload.nota)).toContain('Contém dado pessoal')
  })

  it('leaves empty data out of the fields', () => {
    const fields = leadFields(row({ source: 'google_maps', extras: { nota: 4.8, avaliacoes: 120 }, activity: null }))
    expect(fields).toEqual({
      'Nota no Google': '4,8',
      'Avaliações no Google': '120',
      Endereço: 'Avenida T 63, 1234 - Setor Bueno',
      CEP: '74230100',
    })
  })

  it('the spreadsheet has one value per column', () => {
    const cells = RESULT_EXPORT_COLUMNS.map((c) => c.value(row()))
    expect(cells).toHaveLength(RESULT_EXPORT_COLUMNS.length)
    expect(cells.slice(0, 4)).toEqual(['Clinica Sorriso', '+5562999998888', 'Celular', 'Sim'])
  })
})
