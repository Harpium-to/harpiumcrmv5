import { describe, expect, it } from 'vitest'

import { hostedUazapi, isHostedBaseUrl } from './hosted'

describe('hostedUazapi', () => {
  it('is on only with both variables, without a trailing slash', () => {
    expect(
      hostedUazapi({ UAZAPI_BASE_URL: 'https://harpium.uazapi.com/', UAZAPI_ADMIN_TOKEN: ' tok ' }),
    ).toEqual({ baseUrl: 'https://harpium.uazapi.com', adminToken: 'tok' })
    expect(hostedUazapi({ UAZAPI_BASE_URL: 'https://harpium.uazapi.com' })).toBeNull()
    expect(hostedUazapi({ UAZAPI_ADMIN_TOKEN: 'tok' })).toBeNull()
  })

  it('recognises a CRM whose instance lives on the Harpium’s server', () => {
    const hosted = { baseUrl: 'https://harpium.uazapi.com', adminToken: 'tok' }
    expect(isHostedBaseUrl('https://harpium.uazapi.com/', hosted)).toBe(true)
    expect(isHostedBaseUrl('https://outro.uazapi.com', hosted)).toBe(false)
    expect(isHostedBaseUrl('https://harpium.uazapi.com', null)).toBe(false)
    expect(isHostedBaseUrl(null, hosted)).toBe(false)
  })
})
