import { describe, expect, it, vi } from 'vitest'

import { cnpjLead, formatCnpj, titleCase, type CnpjRow } from './cnpj'
import { createMapsSource, flattenPlaces, mapsKeep, mapsLead, mapsQueries, perQueryLimit } from './maps'

const row = (over: Partial<CnpjRow> = {}): CnpjRow => ({
  cnpj: '12345678000190',
  matriz: true,
  nome_fantasia: 'CLINICA SORRISO',
  razao_social: 'CLINICA SORRISO LTDA',
  abertura: '2019-03-05',
  cnae: '8630504',
  cnae_descricao: 'Atividade odontológica',
  endereco: 'AVENIDA T 63, 1234 - SALA 5',
  bairro: 'SETOR BUENO',
  cep: '74230100',
  uf: 'GO',
  municipio: 9373,
  municipio_nome: 'GOIANIA',
  telefone1: '6232221111',
  telefone2: '62999998888',
  email: 'contato@sorriso.com.br',
  porte: '01',
  capital: '50000.00',
  mei: false,
  natureza: '2062',
  responsavel: 'ANA SOUZA',
  ...over,
})

describe('the CNPJ source', () => {
  it('writes names the way people read them', () => {
    expect(titleCase('CLINICA SORRISO DE GOIAS LTDA')).toBe('Clinica Sorriso de Goias LTDA')
    expect(titleCase('  ')).toBeNull()
    expect(formatCnpj('12345678000190')).toBe('12.345.678/0001-90')
  })

  it('turns a row of the base into a lead, mobile first', () => {
    expect(cnpjLead(row())).toEqual({
      source: 'cnpj',
      externalKey: '12345678000190',
      kind: 'empresa',
      name: 'Clinica Sorriso',
      phone: '+5562999998888',
      email: 'contato@sorriso.com.br',
      website: null,
      instagram: null,
      address: 'Avenida T 63, 1234 - Sala 5',
      district: 'Setor Bueno',
      city: 'Goiania',
      uf: 'GO',
      cep: '74230100',
      activity: 'Atividade odontológica',
      extras: {
        cnpj: '12.345.678/0001-90',
        razao_social: 'Clinica Sorriso LTDA',
        porte: 'Microempresa',
        abertura: '2019-03-05',
        capital: 50000,
        unidade: 'Matriz',
        responsavel: 'Ana Souza',
      },
    })
  })

  it('marks a MEI as personal data and does not repeat the person as "responsável"', () => {
    const lead = cnpjLead(row({ mei: true, nome_fantasia: null, razao_social: 'JOAO PEREIRA', responsavel: 'JOAO PEREIRA' }))
    expect(lead.kind).toBe('pessoa')
    expect(lead.name).toBe('Joao Pereira')
    expect(lead.extras.porte).toBe('MEI')
    expect(lead.extras.responsavel).toBeNull()
    expect(cnpjLead(row({ natureza: '2135' })).kind).toBe('pessoa')
  })
})

const place = (over: Record<string, unknown> = {}) => ({
  place_id: 'ChIJ-1',
  name: 'Odonto Bueno',
  phone: '+55 62 99999-8888',
  site: 'https://odontobueno.com.br/',
  full_address: 'Av. T-63, 1234 - Setor Bueno, Goiânia - GO, 74230-100',
  city: 'Goiânia',
  postal_code: '74230-100',
  category: 'Dentista',
  rating: 4.8,
  reviews: 120,
  location_link: 'https://maps.google.com/?cid=1',
  business_status: 'OPERATIONAL',
  ...over,
})

const where = { cidade: 'Goiânia', uf: 'GO' }

describe('the Google Maps source', () => {
  it('one search for the city, or one per neighbourhood', () => {
    expect(mapsQueries({ termo: 'dentista', ...where })).toEqual(['dentista, Goiânia, GO, Brasil'])
    expect(mapsQueries({ termo: 'dentista', ...where, bairros: ['Setor Bueno', 'Centro'] })).toEqual([
      'dentista, Setor Bueno, Goiânia, GO, Brasil',
      'dentista, Centro, Goiânia, GO, Brasil',
    ])
    expect(perQueryLimit(100, 1)).toBe(100)
    expect(perQueryLimit(100, 4)).toBe(25)
    expect(perQueryLimit(30, 4)).toBe(20)
    expect(perQueryLimit(2000, 1)).toBe(400)
  })

  it('turns a place into a lead', () => {
    expect(mapsLead(place(), where)).toMatchObject({
      source: 'google_maps',
      externalKey: 'ChIJ-1',
      kind: 'empresa',
      name: 'Odonto Bueno',
      phone: '+5562999998888',
      website: 'https://odontobueno.com.br/',
      city: 'Goiânia',
      uf: 'GO',
      activity: 'Dentista',
      extras: { nota: 4.8, avaliacoes: 120 },
    })
  })

  it('an Instagram page as "site" is an Instagram, not a site', () => {
    const lead = mapsLead(place({ site: 'https://www.instagram.com/odonto.bueno/' }), where)
    expect(lead?.website).toBeNull()
    expect(lead?.instagram).toBe('@odonto.bueno')
  })

  it('leaves out what has no id, no name, or closed for good', () => {
    expect(mapsLead(place({ place_id: null, google_id: null }), where)).toBeNull()
    expect(mapsLead(place({ name: ' ' }), where)).toBeNull()
    expect(mapsLead(place({ business_status: 'CLOSED_PERMANENTLY' }), where)).toBeNull()
  })

  it('applies our filters to what came', () => {
    const lead = mapsLead(place(), where)!
    const f = { termo: 'dentista', ...where }
    expect(mapsKeep(lead, f)).toBe(true)
    expect(mapsKeep(lead, { ...f, nota_min: 4.9 })).toBe(false)
    expect(mapsKeep(lead, { ...f, avaliacoes_min: 200 })).toBe(false)
    expect(mapsKeep(lead, { ...f, site: 'sem' })).toBe(false)
    expect(mapsKeep(lead, { ...f, site: 'com', so_celular: true })).toBe(true)
    expect(mapsKeep(mapsLead(place({ phone: '+55 62 3222-1111' }), where)!, { ...f, so_celular: true })).toBe(false)
    expect(mapsKeep(mapsLead(place({ phone: null }), where)!, { ...f, com_telefone: true })).toBe(false)
  })

  it('submits the request, waits, then brings the places once', async () => {
    vi.stubEnv('OUTSCRAPER_API_KEY', 'test-key')
    const calls: { url: string; body: unknown }[] = []
    const answers = [
      { id: 'req-1', status: 'Pending' },
      { id: 'req-1', status: 'Pending' },
      { id: 'req-1', status: 'Success', data: [[place(), place({ place_id: 'ChIJ-2', rating: 3 })], [place()]] },
    ]
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify(answers.shift()), { status: 200 })
    }) as typeof fetch
    const source = createMapsSource({ fetch: fakeFetch })
    const filters = { termo: 'dentista', ...where, nota_min: 4 }

    const first = await source.fetchPage(filters, {}, 100)
    expect(first).toMatchObject({ waiting: true, cursor: { pedido: 'req-1' }, leads: [] })
    expect(calls[0].url).toContain('/google-maps-search')
    expect(calls[0].body).toMatchObject({
      query: ['dentista, Goiânia, GO, Brasil'],
      organizationsPerQueryLimit: 100,
      async: true,
      dropDuplicates: true,
      region: 'BR',
    })

    const second = await source.fetchPage(filters, first.cursor!, 100)
    expect(second.waiting).toBe(true)

    const third = await source.fetchPage(filters, second.cursor!, 100)
    expect(third.waiting).toBe(false)
    expect(third.cursor).toBeNull()
    // Three places came (one repeated, one below the rating): one is kept.
    expect(third.fetched).toBe(3)
    expect(third.leads.map((l) => l.externalKey)).toEqual(['ChIJ-1'])
    expect(third.costUsd).toBeCloseTo(0.009)
    vi.unstubAllEnvs()
  })

  it('says so when the service refuses', async () => {
    vi.stubEnv('OUTSCRAPER_API_KEY', 'bad')
    const source = createMapsSource({
      fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch,
    })
    await expect(source.fetchPage({ termo: 'dentista', ...where }, {}, 10)).rejects.toThrow('recusou a chave')
    vi.unstubAllEnvs()
  })

  it('flattens whatever shape the lists come in', () => {
    expect(flattenPlaces([[{ a: 1 }], [{ b: 2 }, [{ c: 3 }]], null])).toHaveLength(3)
  })
})
