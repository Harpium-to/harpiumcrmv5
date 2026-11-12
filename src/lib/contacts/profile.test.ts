import { describe, expect, it } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'
import {
  contactVariables,
  loadContactProfile,
  renderContactProfile,
  usableName,
  variableKey,
} from './profile'

const ACC = 'acc-1'

function world(): Record<string, Row[]> {
  return {
    contacts: [
      {
        id: 'c1',
        account_id: ACC,
        name: 'Ana Souza',
        phone: '+5563999990000',
        company: 'Planejados Silva',
        city: 'Palmas',
        email: null,
        source: 'quiz-planejados',
      },
      { id: 'c-other', account_id: 'acc-2', name: 'Outra conta', phone: '+5511900000000' },
    ],
    custom_fields: [
      { id: 'f1', account_id: ACC, field_name: 'Faturamento mensal', created_at: '2026-01-01' },
      {
        id: 'f2',
        account_id: ACC,
        field_name: 'Desafio',
        field_key: 'qual_seu_maior_desafio?',
        created_at: '2026-01-02',
      },
      { id: 'f3', account_id: ACC, field_name: 'Vazio', created_at: '2026-01-03' },
      { id: 'f-x', account_id: 'acc-2', field_name: 'Segredo', created_at: '2026-01-01' },
    ],
    contact_custom_values: [
      { contact_id: 'c1', custom_field_id: 'f1', value: '75 a 150 mil' },
      { contact_id: 'c1', custom_field_id: 'f2', value: 'Só pedem preço' },
      { contact_id: 'c1', custom_field_id: 'f3', value: '  ' },
      { contact_id: 'c1', custom_field_id: 'f-x', value: 'não pode aparecer' },
    ],
    contact_tags: [{ contact_id: 'c1', tag_id: 't1' }],
    tags: [{ id: 't1', account_id: ACC, name: 'rota-a' }],
    deals: [
      { id: 'd1', account_id: ACC, contact_id: 'c1', title: 'Lead quiz · Ana', stage_id: 's1', status: 'open' },
      { id: 'd2', account_id: ACC, contact_id: 'c1', title: 'Antigo', stage_id: 's1', status: 'won' },
    ],
    pipeline_stages: [{ id: 's1', name: 'Novo lead' }],
  }
}

describe('variableKey / usableName', () => {
  it('folds a field name to what {{ campo.* }} accepts', () => {
    expect(variableKey('Faturamento mensal')).toBe('faturamento_mensal')
    expect(variableKey('Qual é o seu maior desafio?')).toBe('qual_e_o_seu_maior_desafio')
    expect(variableKey('Ticket médio (R$)')).toBe('ticket_medio_r')
  })

  it('a name that is only the phone is no name', () => {
    expect(usableName('5563999990000')).toBeNull()
    expect(usableName('+55 (63) 99999-0000')).toBeNull()
    expect(usableName(' Ana ')).toBe('Ana')
  })
})

describe('loadContactProfile', () => {
  it('reads the contact, filled fields of its account, tags and open deals', async () => {
    const p = await loadContactProfile(fakeDb(world()), ACC, 'c1')
    expect(p).toMatchObject({
      name: 'Ana Souza',
      company: 'Planejados Silva',
      city: 'Palmas',
      email: null,
      source: 'quiz-planejados',
      tags: ['rota-a'],
      deals: [{ title: 'Lead quiz · Ana', stage: 'Novo lead' }],
    })
    expect(p?.fields).toEqual([
      { name: 'Faturamento mensal', key: 'faturamento_mensal', leadKey: null, value: '75 a 150 mil' },
      { name: 'Desafio', key: 'desafio', leadKey: 'qual_seu_maior_desafio', value: 'Só pedem preço' },
    ])
  })

  it('never reads a contact of another account', async () => {
    expect(await loadContactProfile(fakeDb(world()), ACC, 'c-other')).toBeNull()
  })
})

describe('renderContactProfile', () => {
  it('lists what is known, fields last', async () => {
    const p = await loadContactProfile(fakeDb(world()), ACC, 'c1')
    expect(renderContactProfile(p)).toBe(
      [
        'Nome: Ana Souza',
        'Empresa: Planejados Silva',
        'Cidade: Palmas',
        'Origem: quiz-planejados',
        'Etiquetas: rota-a',
        'Negócio aberto: Lead quiz · Ana (etapa Novo lead)',
        'Campos:',
        '- Faturamento mensal: 75 a 150 mil',
        '- Desafio: Só pedem preço',
      ].join('\n'),
    )
  })

  it('says nothing for a bare contact, and caps a long one', () => {
    const bare = {
      name: null, phone: '+55', email: null, company: null, city: null, instagram: null,
      jobTitle: null, segment: null, website: null, source: null, tags: [], fields: [], deals: [],
    }
    expect(renderContactProfile(bare)).toBeNull()
    expect(renderContactProfile(null)).toBeNull()
    const long = {
      ...bare,
      fields: Array.from({ length: 40 }, (_, i) => ({ name: `Campo ${i}`, key: `campo_${i}`, leadKey: null, value: 'x'.repeat(400) })),
    }
    expect(renderContactProfile(long)!.length).toBeLessThanOrEqual(2500)
  })
})

describe('contactVariables', () => {
  it('names contato.* and campo.*, a renamed lead field under both keys', async () => {
    const vars = contactVariables(await loadContactProfile(fakeDb(world()), ACC, 'c1'))
    expect(vars).toMatchObject({
      'contato.nome': 'Ana Souza',
      'contato.primeiro_nome': 'Ana',
      'contato.empresa': 'Planejados Silva',
      'contato.cidade': 'Palmas',
      'contato.email': '',
      'campo.faturamento_mensal': '75 a 150 mil',
      'campo.desafio': 'Só pedem preço',
      'campo.qual_seu_maior_desafio': 'Só pedem preço',
    })
    expect(contactVariables(null)).toEqual({})
  })
})
