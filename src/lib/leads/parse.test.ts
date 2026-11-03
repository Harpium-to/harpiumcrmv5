import { describe, it, expect } from 'vitest'
import { normalizeLead } from './parse'

describe('normalizeLead — Google Lead Form', () => {
  it('maps user_column_data columns', () => {
    const r = normalizeLead({
      lead_id: 'g-123',
      form_id: 'form-9',
      campaign_id: 'camp-1',
      google_key: 'secret',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Ana Souza' },
        { column_id: 'EMAIL', string_value: 'ana@ex.com' },
        { column_id: 'PHONE_NUMBER', string_value: '+5511999998888' },
        { column_id: 'COMPANY_NAME', string_value: 'Acme' },
      ],
    })
    expect(r).toEqual({
      source: 'google',
      fullName: 'Ana Souza',
      email: 'ana@ex.com',
      phone: '+5511999998888',
      company: 'Acme',
      campaign: 'camp-1',
      formName: 'form-9',
      externalId: 'g-123',
    })
  })

  it('joins first + last name when FULL_NAME is absent', () => {
    const r = normalizeLead({
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'Ana' },
        { column_id: 'LAST_NAME', string_value: 'Souza' },
      ],
    })
    expect(r.source).toBe('google')
    expect(r.fullName).toBe('Ana Souza')
  })
})

describe('normalizeLead — Meta Lead Ads', () => {
  it('maps field_data with values arrays', () => {
    const r = normalizeLead({
      id: 'm-777',
      form_id: 'f-1',
      campaign_name: 'Promo Julho',
      field_data: [
        { name: 'full_name', values: ['João Lima'] },
        { name: 'email', values: ['joao@ex.com'] },
        { name: 'phone_number', values: ['+5521988887777'] },
      ],
    })
    expect(r).toMatchObject({
      source: 'meta',
      fullName: 'João Lima',
      email: 'joao@ex.com',
      phone: '+5521988887777',
      campaign: 'Promo Julho',
      formName: 'f-1',
      externalId: 'm-777',
    })
  })
})

describe('normalizeLead — generic JSON', () => {
  it('reads flat English keys and declared source', () => {
    const r = normalizeLead({
      source: 'meta',
      name: 'Carla',
      email: 'carla@ex.com',
      phone: '+5511911112222',
      campaign: 'Black Friday',
    })
    expect(r.source).toBe('meta')
    expect(r.fullName).toBe('Carla')
    expect(r.phone).toBe('+5511911112222')
    expect(r.campaign).toBe('Black Friday')
  })

  it('reads pt-BR aliases', () => {
    const r = normalizeLead({
      nome: 'Pedro',
      telefone: '+5511900000000',
      empresa: 'Loja X',
      campanha: 'Verão',
    })
    expect(r).toMatchObject({
      source: 'other',
      fullName: 'Pedro',
      phone: '+5511900000000',
      company: 'Loja X',
      campaign: 'Verão',
    })
  })

  it('does not crash on empty / non-object payloads', () => {
    expect(normalizeLead(null).source).toBe('other')
    expect(normalizeLead('nope').fullName).toBeNull()
    expect(normalizeLead({}).phone).toBeNull()
  })
})
