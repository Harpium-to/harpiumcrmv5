import { describe, expect, it } from 'vitest'

import { classifyLead, type CrmKnowledge } from './classify'
import { bestPhone, leadPhone, phoneKeys, phoneKind } from './phone'
import type { ExtractedLead } from './types'

const lead = (over: Partial<ExtractedLead> = {}): ExtractedLead => ({
  source: 'cnpj',
  externalKey: '12345678000190',
  kind: 'empresa',
  name: 'Clínica Sorriso',
  phone: '+5562999998888',
  email: null,
  website: null,
  instagram: null,
  address: null,
  district: null,
  city: 'Goiânia',
  uf: 'GO',
  cep: null,
  activity: null,
  extras: {},
  ...over,
})

const nothing = (): CrmKnowledge => ({
  blocked: new Set(),
  contacts: new Map(),
  extractedKeys: new Set(),
  extractedPhones: new Set(),
})

describe('phones', () => {
  it('normalizes what the sources write', () => {
    expect(leadPhone('62999998888')).toBe('+5562999998888')
    expect(leadPhone('6299998888')).toBe('+5562999998888')
    expect(leadPhone('+55 62 3222-1111')).toBe('+556232221111')
    expect(leadPhone('123')).toBeNull()
    expect(leadPhone(null)).toBeNull()
  })
  it('tells a mobile from a landline', () => {
    expect(phoneKind('+5562999998888')).toBe('celular')
    expect(phoneKind('+556232221111')).toBe('fixo')
    expect(phoneKind('+14155550100')).toBeNull()
  })
  it('prefers the mobile of the two', () => {
    expect(bestPhone('6232221111', '62999998888')).toBe('+5562999998888')
    expect(bestPhone('6232221111', null)).toBe('+556232221111')
    expect(bestPhone(null, '')).toBeNull()
  })
})

describe('classifyLead', () => {
  it('new when the CRM knows nothing about it', () => {
    expect(classifyLead(lead(), nothing())).toEqual({ status: 'novo', matchedContactId: null })
  })

  it('a contact, with or without the ninth digit', () => {
    const known = nothing()
    known.contacts.set('556299998888', 'contact-1')
    expect(classifyLead(lead(), known)).toEqual({ status: 'contato', matchedContactId: 'contact-1' })
  })

  it('blocked wins over everything', () => {
    const known = nothing()
    for (const key of phoneKeys('+5562999998888')) known.blocked.add(key)
    known.contacts.set('5562999998888', 'contact-1')
    expect(classifyLead(lead(), known).status).toBe('bloqueado')
  })

  it('extracted before: the same CNPJ, or the same number', () => {
    const byKey = nothing()
    byKey.extractedKeys.add('12345678000190')
    expect(classifyLead(lead(), byKey).status).toBe('extraido')
    const byPhone = nothing()
    byPhone.extractedPhones.add('5562999998888')
    expect(classifyLead(lead({ externalKey: '99999999000100' }), byPhone).status).toBe('extraido')
  })

  it('no phone', () => {
    expect(classifyLead(lead({ phone: null }), nothing()).status).toBe('sem_telefone')
  })
})
