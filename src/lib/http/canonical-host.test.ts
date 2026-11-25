import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canonicalHostRedirect } from './canonical-host'

const OLD = 'harpium-crm.netlify.app'
const req = (over: Partial<Parameters<typeof canonicalHostRedirect>[0]> = {}) => ({
  method: 'GET',
  host: OLD,
  pathname: '/inbox',
  search: '?c=1',
  ...over,
})

let saved: string | undefined
beforeEach(() => {
  saved = process.env.NEXT_PUBLIC_SITE_URL
  process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.harpium.com.br'
})
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = saved
})

describe('canonicalHostRedirect', () => {
  it('sends a page on the old address to the same path on the new one', () => {
    expect(canonicalHostRedirect(req())?.toString()).toBe('https://crm.harpium.com.br/inbox?c=1')
    expect(canonicalHostRedirect(req({ pathname: '/', search: '' }))?.toString()).toBe(
      'https://crm.harpium.com.br/',
    )
    expect(canonicalHostRedirect(req({ method: 'HEAD' }))).not.toBeNull()
  })

  it('leaves /api alone (webhooks, leads, Agency OS, extension)', () => {
    expect(canonicalHostRedirect(req({ pathname: '/api/whatsapp/webhook' }))).toBeNull()
    expect(canonicalHostRedirect(req({ pathname: '/api' }))).toBeNull()
    expect(canonicalHostRedirect(req({ pathname: '/apis' }))).not.toBeNull()
  })

  it('leaves anything but GET/HEAD alone', () => {
    expect(canonicalHostRedirect(req({ method: 'POST' }))).toBeNull()
    expect(canonicalHostRedirect(req({ method: 'OPTIONS' }))).toBeNull()
  })

  it('leaves deploy previews, other hosts and the new host alone', () => {
    expect(canonicalHostRedirect(req({ host: 'abc123--harpium-crm.netlify.app' }))).toBeNull()
    expect(canonicalHostRedirect(req({ host: 'crm.harpium.com.br' }))).toBeNull()
    expect(canonicalHostRedirect(req({ host: 'quiz.harpium.com.br' }))).toBeNull()
    expect(canonicalHostRedirect(req({ host: 'localhost:3000' }))).toBeNull()
    expect(canonicalHostRedirect(req({ host: null }))).toBeNull()
  })

  it('does nothing while the site URL is still the netlify.app address, or unset', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://harpium-crm.netlify.app'
    expect(canonicalHostRedirect(req())).toBeNull()
    expect(canonicalHostRedirect(req({ host: 'HARPIUM-CRM.netlify.app:443' }))).toBeNull()
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(canonicalHostRedirect(req())).toBeNull()
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url'
    expect(canonicalHostRedirect(req())).toBeNull()
  })
})
