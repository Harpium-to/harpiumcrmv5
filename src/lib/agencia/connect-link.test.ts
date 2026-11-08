import { describe, expect, it } from 'vitest'
import {
  buildConnectLink,
  connectMessage,
  readConnectIntent,
  whatsappShareUrl,
} from './connect-link'

const CRM = '62f3a9ad-e48f-4d08-b8b4-d1465c080300'
const OTHER = '11111111-2222-3333-4444-555555555555'

describe('buildConnectLink', () => {
  it('points at Settings › WhatsApp with the connect flag and the CRM', () => {
    const url = new URL(buildConnectLink('https://harpium-crm.netlify.app', CRM))
    expect(url.origin).toBe('https://harpium-crm.netlify.app')
    expect(url.pathname).toBe('/settings')
    expect(url.searchParams.get('tab')).toBe('whatsapp')
    expect(url.searchParams.get('conectar')).toBe('1')
    expect(url.searchParams.get('crm')).toBe(CRM)
  })

  it('ignores a trailing slash on the origin', () => {
    expect(buildConnectLink('https://crm.example.com/', CRM)).toBe(
      `https://crm.example.com/settings?tab=whatsapp&conectar=1&crm=${CRM}`,
    )
  })
})

describe('connectMessage and whatsappShareUrl', () => {
  it('names the CRM and carries the link', () => {
    const msg = connectMessage('https://x.test/settings', 'Clínica Sol')
    expect(msg).toContain('ao CRM Clínica Sol')
    expect(msg).toContain('https://x.test/settings')
    expect(msg).toContain('Conectar com o Facebook')
  })

  it('works without a CRM name', () => {
    expect(connectMessage('https://x.test')).toContain('da sua empresa ao CRM,')
  })

  it('URL-encodes the whole message for wa.me', () => {
    const url = whatsappShareUrl('Olá & tchau\nhttps://x.test/?a=1&b=2')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe(
      'Olá & tchau\nhttps://x.test/?a=1&b=2',
    )
  })
})

describe('readConnectIntent', () => {
  const params = (q: string) => new URLSearchParams(q)

  it('highlights when conectar=1', () => {
    expect(readConnectIntent(params('tab=whatsapp&conectar=1'), CRM)).toEqual({
      highlight: true,
      switchTo: null,
    })
  })

  it('does nothing for a plain settings URL', () => {
    expect(readConnectIntent(params('tab=whatsapp'), CRM)).toEqual({
      highlight: false,
      switchTo: null,
    })
  })

  it('asks to switch when the link is for another CRM', () => {
    expect(readConnectIntent(params(`conectar=1&crm=${OTHER}`), CRM).switchTo).toBe(OTHER)
  })

  it('does not switch when already on that CRM', () => {
    expect(readConnectIntent(params(`conectar=1&crm=${CRM}`), CRM).switchTo).toBeNull()
  })

  it('waits for the active CRM to be known', () => {
    expect(readConnectIntent(params(`conectar=1&crm=${OTHER}`), null).switchTo).toBeNull()
  })

  it('ignores a crm value that is not an id', () => {
    expect(readConnectIntent(params('conectar=1&crm=../../evil'), CRM).switchTo).toBeNull()
  })
})
