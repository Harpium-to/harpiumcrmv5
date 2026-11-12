import { afterEach, describe, expect, it, vi } from 'vitest'

import { crmOrigin } from './origin'

// What Netlify hands a function: the deploy's own host in the URL, the
// address people actually used in the forwarded headers.
const fromNetlify = () =>
  new Request('https://6af5d76c0e4562217008cd37--harpium-crm.netlify.app/api/google/oauth/callback', {
    headers: { 'x-forwarded-host': 'harpium-crm.netlify.app', 'x-forwarded-proto': 'https' },
  })

describe('crmOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is the configured public address, never the deploy’s own host', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://harpium-crm.netlify.app/')
    expect(crmOrigin(fromNetlify())).toBe('https://harpium-crm.netlify.app')
  })

  it('without it, the address the person used (forwarded host)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    expect(crmOrigin(fromNetlify())).toBe('https://harpium-crm.netlify.app')
  })

  it('a bare local server: the request’s own address', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    expect(crmOrigin(new Request('http://localhost:3000/api/google/oauth/start'))).toBe(
      'http://localhost:3000',
    )
  })
})
