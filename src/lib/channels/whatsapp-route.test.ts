import { describe, expect, it } from 'vitest'

import { effectivePath, pickProvider, type WhatsAppRouteFacts } from './whatsapp-route'

const facts = (over: Partial<WhatsAppRouteFacts> = {}): WhatsAppRouteFacts => ({
  path: null,
  uazapiReady: false,
  evolutionReady: false,
  ...over,
})

describe('pickProvider', () => {
  it('official is always Meta, even with a QR instance still enabled', () => {
    // The client switched back to the official path: an old UAZAPI
    // instance must not keep answering from the other number.
    expect(pickProvider(facts({ path: 'oficial', uazapiReady: true }))).toBe('meta')
    expect(pickProvider(facts({ path: 'oficial' }))).toBe('meta')
  })

  it('unofficial is UAZAPI, then Evolution', () => {
    expect(pickProvider(facts({ path: 'nao_oficial', uazapiReady: true, evolutionReady: true }))).toBe(
      'uazapi',
    )
    expect(pickProvider(facts({ path: 'nao_oficial', evolutionReady: true }))).toBe('evolution')
  })

  it('unofficial with nothing connected is null, never Meta', () => {
    // Falling back to Meta would answer from a different number.
    expect(pickProvider(facts({ path: 'nao_oficial' }))).toBeNull()
  })

  it('with no choice keeps the rule the inbox had before 061', () => {
    expect(pickProvider(facts({ uazapiReady: true, evolutionReady: true }))).toBe('uazapi')
    expect(pickProvider(facts({ evolutionReady: true }))).toBe('evolution')
    expect(pickProvider(facts())).toBe('meta')
  })
})

describe('effectivePath', () => {
  it('is the stored choice when there is one', () => {
    expect(effectivePath({ ...facts({ path: 'oficial', uazapiReady: true }), metaConfigured: false })).toBe(
      'oficial',
    )
  })

  it('before anyone chose, follows what is connected', () => {
    expect(effectivePath({ ...facts({ uazapiReady: true }), metaConfigured: true })).toBe('nao_oficial')
    expect(effectivePath({ ...facts(), metaConfigured: true })).toBe('oficial')
  })

  it('is null for a CRM with nothing, which is when the choice screen shows', () => {
    expect(effectivePath({ ...facts(), metaConfigured: false })).toBeNull()
  })
})
