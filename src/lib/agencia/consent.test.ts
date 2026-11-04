import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { consentAllowsRows, describeRequest, loadConsent } from './consent'

const client = (result: { data: unknown; error: unknown }) =>
  ({ rpc: () => Promise.resolve(result) }) as unknown as SupabaseClient

describe('consentAllowsRows', () => {
  it('only read and full show personal data', () => {
    expect(consentAllowsRows('metrics')).toBe(false)
    expect(consentAllowsRows('read')).toBe(true)
    expect(consentAllowsRows('full')).toBe(true)
  })

  it('before 049 there is no consent to enforce — the console works as it always did', () => {
    expect(consentAllowsRows(null)).toBe(true)
  })
})

describe('loadConsent', () => {
  it('returns the level the database reports', async () => {
    expect(await loadConsent(client({ data: 'read', error: null }), 'a')).toBe('read')
  })

  it('a missing function means 049 is not applied: not enforced', async () => {
    expect(
      await loadConsent(client({ data: null, error: { code: 'PGRST202' } }), 'a'),
    ).toBeNull()
  })

  it('any other failure fails closed to metrics', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await loadConsent(client({ data: null, error: { code: '57014' } }), 'a'),
    ).toBe('metrics')
    expect(await loadConsent(client({ data: 'tudo', error: null }), 'a')).toBe('metrics')
    spy.mockRestore()
  })
})

describe('describeRequest', () => {
  it('says the level and, when temporary, for how long', () => {
    expect(describeRequest('full', null)).toBe('Total')
    expect(describeRequest('read', 1)).toBe('Leitura por 1 hora')
    expect(describeRequest('full', 24)).toBe('Total por 1 dia')
    expect(describeRequest('full', 72)).toBe('Total por 3 dias')
    expect(describeRequest('read', 36)).toBe('Leitura por 36 horas')
  })
})
