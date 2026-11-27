import { describe, expect, it } from 'vitest'

import { extractContacts, isPrivateAddress, publicUrl, readSite, robotsClosesSite } from './enrich'

describe('what a site says', () => {
  it('finds the WhatsApp link, the e-mail and the Instagram', () => {
    const html = `
      <a href="https://api.whatsapp.com/send?phone=5562999998888&amp;text=Oi">WhatsApp</a>
      <a href="mailto:contato@sorriso.com.br?subject=Oi">E-mail</a>
      <a href="https://www.instagram.com/p/abc123/">post</a>
      <a href="https://www.instagram.com/clinica.sorriso/">Instagram</a>`
    expect(extractContacts(html)).toEqual({
      whatsapp: '+5562999998888',
      email: 'contato@sorriso.com.br',
      instagram: '@clinica.sorriso',
    })
  })
  it('reads wa.me without the country code', () => {
    expect(extractContacts('<a href="https://wa.me/62999998888">oi</a>').whatsapp).toBe('+5562999998888')
  })
  it('skips e-mails that are not a contact', () => {
    expect(extractContacts('logo@2x.png noreply@site.com vendas@loja.com.br').email).toBe('vendas@loja.com.br')
    expect(extractContacts('nada aqui')).toEqual({ whatsapp: null, email: null, instagram: null })
  })
})

describe('robots.txt', () => {
  it('closes the site only when it says so to everyone', () => {
    expect(robotsClosesSite('User-agent: *\nDisallow: /')).toBe(true)
    expect(robotsClosesSite('User-agent: *\nDisallow: /admin')).toBe(false)
    expect(robotsClosesSite('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow:')).toBe(false)
    expect(robotsClosesSite('User-agent: a\nUser-agent: *\nDisallow: / # tudo')).toBe(true)
    expect(robotsClosesSite('')).toBe(false)
  })
})

describe('only public web addresses are read', () => {
  it('private and odd addresses are refused', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(publicUrl('http://127.0.0.1/')).toBeNull()
    expect(publicUrl('http://localhost/')).toBeNull()
    expect(publicUrl('ftp://site.com/')).toBeNull()
    expect(publicUrl('https://user:pass@site.com/')).toBeNull()
    expect(publicUrl('https://site.com:8080/')).toBeNull()
    expect(publicUrl('site.com.br')?.toString()).toBe('https://site.com.br/')
  })

  const page = (body: string, init: ResponseInit = {}) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init })

  it('does not call a name that resolves to a private address', async () => {
    let called = false
    const site = await readSite('https://interno.exemplo.com', {
      fetch: (async () => {
        called = true
        return page('x')
      }) as typeof fetch,
      resolve: async () => ['10.0.0.5'],
    })
    expect(site).toBeNull()
    expect(called).toBe(false)
  })

  it('does not follow a redirect into a private address', async () => {
    const site = await readSite('https://site.com.br', {
      fetch: (async (url: unknown) =>
        String(url).endsWith('/robots.txt')
          ? page('', { status: 404 })
          : new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })) as typeof fetch,
      resolve: async () => ['200.1.2.3'],
    })
    expect(site).toBeNull()
  })

  it('reads the page, unless robots.txt closes the site', async () => {
    const html = '<a href="https://wa.me/5562999998888">zap</a>'
    const open = await readSite('https://site.com.br', {
      fetch: (async (url: unknown) => (String(url).endsWith('/robots.txt') ? page('User-agent: *\nDisallow: /admin') : page(html))) as typeof fetch,
      resolve: async () => ['200.1.2.3'],
    })
    expect(open?.whatsapp).toBe('+5562999998888')
    const closed = await readSite('https://site.com.br', {
      fetch: (async (url: unknown) => (String(url).endsWith('/robots.txt') ? page('User-agent: *\nDisallow: /') : page(html))) as typeof fetch,
      resolve: async () => ['200.1.2.3'],
    })
    expect(closed).toBeNull()
  })
})
