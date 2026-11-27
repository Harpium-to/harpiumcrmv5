import { describe, expect, it } from 'vitest'

import { describeFilters, FilterError, parseCnpjFilters, parseMapsFilters, parseRequested } from './filters'

describe('parseCnpjFilters', () => {
  it('needs an activity or a city', () => {
    expect(() => parseCnpjFilters({ ufs: ['GO'] })).toThrow(FilterError)
    expect(parseCnpjFilters({ municipios: [9373] })).toEqual({ tipo: 'todos', municipios: [9373] })
  })

  it('keeps only what it knows, cleaned', () => {
    const f = parseCnpjFilters({
      cnaes: ['8630-5/04', '8630504', 'x'],
      ufs: ['go', 'XX'],
      municipios: ['9373', 0, 'a'],
      bairro: '  Setor%  Bueno_ ',
      cep: '74.230-100',
      tipo: 'mei',
      portes: ['01', '99'],
      abertura_de: '2026-01-01',
      abertura_ate: 'ontem',
      capital_min: '10000',
      unidade: 'matriz',
      so_celular: true,
      com_email: 'sim',
      drop: 'table',
      rotulos: { cnaes: ['Atividade odontológica'], municipios: ['Goiânia/GO'] },
    })
    expect(f).toEqual({
      tipo: 'mei',
      cnaes: ['8630504'],
      ufs: ['GO'],
      municipios: [9373],
      bairro: 'Setor Bueno',
      cep: '74230100',
      portes: ['01'],
      abertura_de: '2026-01-01',
      capital_min: 10000,
      unidade: 'matriz',
      so_celular: true,
      rotulos: { cnaes: ['Atividade odontológica'], municipios: ['Goiânia/GO'] },
    })
  })

  it('refuses ranges the wrong way round', () => {
    expect(() =>
      parseCnpjFilters({ cnaes: ['8630504'], abertura_de: '2026-02-01', abertura_ate: '2026-01-01' }),
    ).toThrow('abertura')
    expect(() => parseCnpjFilters({ cnaes: ['8630504'], capital_min: 10, capital_max: 5 })).toThrow('capital')
  })
})

describe('parseMapsFilters', () => {
  it('needs what, where and the state', () => {
    expect(() => parseMapsFilters({ termo: 'd', cidade: 'Goiânia', uf: 'GO' })).toThrow(FilterError)
    expect(() => parseMapsFilters({ termo: 'dentista', cidade: '', uf: 'GO' })).toThrow(FilterError)
    expect(() => parseMapsFilters({ termo: 'dentista', cidade: 'Goiânia', uf: 'ZZ' })).toThrow(FilterError)
  })
  it('reads the filters of the screen', () => {
    expect(
      parseMapsFilters({
        termo: ' dentista ',
        cidade: 'Goiânia',
        uf: 'go',
        bairros: ['Setor Bueno', 'Setor Bueno', ''],
        nota_min: '4,5',
        avaliacoes_min: 10,
        site: 'sem',
        com_telefone: true,
      }),
    ).toEqual({
      termo: 'dentista',
      cidade: 'Goiânia',
      uf: 'GO',
      bairros: ['Setor Bueno'],
      nota_min: 4.5,
      avaliacoes_min: 10,
      site: 'sem',
      com_telefone: true,
    })
  })
})

describe('parseRequested', () => {
  it('caps at the ceiling of the source', () => {
    expect(parseRequested('cnpj', 99999)).toBe(2000)
    expect(parseRequested('google_maps', '120')).toBe(120)
    expect(() => parseRequested('cnpj', 0)).toThrow(FilterError)
  })
})

describe('describeFilters', () => {
  it('says the search in one line', () => {
    expect(
      describeFilters('cnpj', {
        tipo: 'mei',
        cnaes: ['8630504'],
        rotulos: { cnaes: ['Atividade odontológica'], municipios: ['Goiânia/GO'] },
        abertura_de: '2026-01-01',
      }),
    ).toBe('Atividade odontológica · Goiânia/GO · MEI e autônomos · abertas desde 01/01/2026')
    expect(describeFilters('google_maps', { termo: 'dentista', cidade: 'Goiânia', uf: 'GO', site: 'sem' })).toBe(
      'dentista em Goiânia/GO · sem site',
    )
  })
})
