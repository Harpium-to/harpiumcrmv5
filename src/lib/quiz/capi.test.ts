import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { buildConversionEvent, fbcFrom } from './capi'

const sha = (v: string) => createHash('sha256').update(v).digest('hex')
const at = new Date('2026-11-12T12:00:00.000Z')

describe('buildConversionEvent', () => {
  it('sends the same event id the Pixel used, and the contact hashed', () => {
    const body = buildConversionEvent({
      pixelId: '123',
      eventName: 'Lead',
      eventId: 'evt-1',
      at,
      pageUrl: 'https://crm.test/q/diagnostico',
      slug: 'diagnostico',
      contact: { phone: '+55 (63) 91234-5678', email: ' Ana@Loja.com ', name: 'Ana Maria' },
      ip: '203.0.113.9',
      userAgent: 'UA',
      fbp: 'fb.1.1.2',
      fbc: 'fb.1.1.abc',
    }) as { data: Record<string, unknown>[] }

    expect(body.data).toHaveLength(1)
    const event = body.data[0]
    expect(event).toMatchObject({
      event_name: 'Lead',
      event_id: 'evt-1',
      event_time: Math.floor(at.getTime() / 1000),
      action_source: 'website',
      event_source_url: 'https://crm.test/q/diagnostico',
      custom_data: { content_name: 'diagnostico' },
    })
    expect(event.user_data).toEqual({
      ph: [sha('5563912345678')],
      em: [sha('ana@loja.com')],
      fn: [sha('ana')],
      client_ip_address: '203.0.113.9',
      client_user_agent: 'UA',
      fbp: 'fb.1.1.2',
      fbc: 'fb.1.1.abc',
    })
    // Nothing readable about the person leaves the server.
    expect(JSON.stringify(body)).not.toContain('91234')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('ana@')
  })

  it('leaves out what it does not know', () => {
    const body = buildConversionEvent({
      pixelId: '123',
      eventName: 'QuizMorno',
      eventId: null,
      at,
      pageUrl: null,
      slug: 's',
      contact: {},
      ip: null,
      userAgent: null,
    }) as { data: Record<string, unknown>[] }
    expect(body.data[0].user_data).toEqual({})
    expect(body.data[0]).not.toHaveProperty('event_id')
    expect(body.data[0]).not.toHaveProperty('event_source_url')
  })

  it('builds fbc from the click id of the ad', () => {
    expect(fbcFrom('abc', at)).toBe(`fb.1.${at.getTime()}.abc`)
    expect(fbcFrom(undefined, at)).toBeUndefined()
  })
})
