import { describe, expect, it } from 'vitest'

import {
  isAgencyAccessLevel,
  isCrmNiche,
  isCrmStatus,
  nicheLabel,
  toCrmStatus,
} from './crm'

describe('CRM vocabulary', () => {
  it('reads a missing status (before migration 050) as active', () => {
    expect(toCrmStatus(undefined)).toBe('active')
    expect(toCrmStatus(null)).toBe('active')
    expect(toCrmStatus('suspended')).toBe('suspended')
    expect(toCrmStatus('deleted')).toBe('active')
  })

  it('accepts only the statuses the database allows', () => {
    expect(isCrmStatus('archived')).toBe(true)
    expect(isCrmStatus('ativo')).toBe(false)
  })

  it('labels niches, and shows an unknown one as-is instead of hiding it', () => {
    expect(nicheLabel('gym')).toBe('Academia / Studio')
    expect(nicheLabel('padaria')).toBe('padaria')
    expect(nicheLabel(null)).toBeNull()
    expect(isCrmNiche('gym')).toBe(true)
    expect(isCrmNiche('padaria')).toBe(false)
  })

  it('knows the three agency access levels', () => {
    expect(isAgencyAccessLevel('metrics')).toBe(true)
    expect(isAgencyAccessLevel('full')).toBe(true)
    expect(isAgencyAccessLevel('total')).toBe(false)
  })
})
