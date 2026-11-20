import { afterEach, describe, expect, it } from 'vitest'

import type { CrmAccess } from './access'
import { registerAgencyOsWebhook } from './aviso'
import { PlatformError } from './errors'
import { loadList, loadMessages, sanitizeSearch } from './listas'
import { clampSince, loadNovidades } from './novidades'
import { fakePlatformDb } from './fake.test-helper'
import { recordingDb, type Row } from './recording-db.test-helper'

const ACC = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const CONV = '33333333-3333-4333-8333-333333333333'
const CONV_OTHER = '44444444-4444-4444-8444-444444444444'
const ORIGIN = 'https://crm.test'
const NOW = new Date('2026-11-20T15:00:00Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function tables(): Record<string, Row[]> {
  return {
    leads: [
      { id: 'l1', account_id: ACC, source: 'quiz-planejados', full_name: 'Ana', raw: { origem: 'quiz-planejados', rota: 'A' }, created_at: ago(1) },
      { id: 'l2', account_id: OTHER, source: 'meta', full_name: 'Outra pessoa', raw: {}, created_at: ago(1) },
    ],
    contacts: [
      { id: 'c1', account_id: ACC, name: 'Ana', phone: '+5563999990000', created_at: ago(5) },
      { id: 'c2', account_id: OTHER, name: 'Outra pessoa', phone: '+5511999990000', created_at: ago(5) },
    ],
    deals: [
      { id: 'd1', account_id: ACC, title: 'Plano anual', value: 4800, status: 'won', pipeline_id: 'p1', closed_at: ago(0.5), created_at: ago(30) },
      { id: 'd2', account_id: OTHER, title: 'Do outro', value: 1, status: 'won', pipeline_id: 'p9', closed_at: ago(0.5), created_at: ago(30) },
    ],
    conversations: [
      { id: CONV, account_id: ACC, contact_id: 'c1', status: 'open', needs_human_since: ago(0.2), created_at: ago(2) },
      { id: CONV_OTHER, account_id: OTHER, contact_id: 'c2', status: 'open', needs_human_since: ago(0.2), created_at: ago(2) },
    ],
    messages: [{ id: 'm1', conversation_id: CONV, content_type: 'text', content_text: 'Oi', created_at: ago(0.2) }],
    calendar_events: [],
    calendars: [],
    contact_tasks: [],
    profiles: [],
    webhook_endpoints: [],
  }
}

const access = (level: 'rows' | 'metrics'): CrmAccess => ({
  accountId: ACC,
  name: 'Harpium Digital',
  status: 'active',
  level,
  via: 'agency',
  role: level === 'rows' ? 'viewer' : null,
  consent: 'read',
})

const req = (q = '') => new Request(`https://crm.test/api/plataforma/v1/crms/${ACC}/x${q}`)

describe('loadList', () => {
  it('lists only the CRM asked for, each item with its link', async () => {
    const { db, log } = recordingDb(tables())
    const leads = await loadList(db, ACC, 'leads', req(), ORIGIN, NOW)
    expect(leads.items).toEqual([
      expect.objectContaining({
        id: 'l1',
        name: 'Ana',
        origin: 'quiz-planejados',
        route: 'A',
        link: expect.stringContaining(`${ORIGIN}/abrir?crm=${ACC}`),
      }),
    ])
    const contatos = await loadList(db, ACC, 'contatos', req(), ORIGIN, NOW)
    expect(contatos.items.map((c) => (c as { id: string }).id)).toEqual(['c1'])
    const conversas = await loadList(db, ACC, 'conversas', req('?esperando=1'), ORIGIN, NOW)
    expect(conversas.items).toEqual([
      expect.objectContaining({ id: CONV, waitingSince: ago(0.2) }),
    ])
    for (const q of log.filter((x) => ['leads', 'contacts', 'conversations', 'deals'].includes(x.table))) {
      expect(q.filters).toContainEqual(['eq', 'account_id', ACC])
    }
  })

  it('a search cannot inject PostgREST syntax', async () => {
    expect(sanitizeSearch('ana,id.eq.1)')).toBe('ana id.eq.1')
    expect(sanitizeSearch('ana@exemplo.com')).toBe('ana@exemplo.com')
    const { db, log } = recordingDb(tables())
    await loadList(db, ACC, 'leads', req('?busca=' + encodeURIComponent('x),account_id.neq.(')), ORIGIN, NOW)
    const or = log.find((q) => q.table === 'leads')!.filters.find(([op]) => op === 'or')
    // Commas and parentheses are what would open a new filter: gone.
    expect(String(or?.[2])).not.toMatch(/[()]/)
    expect(String(or?.[2]).split(',')).toHaveLength(3)
  })

  it('refuses bad filters and an agenda window over 31 days', async () => {
    const { db } = recordingDb(tables())
    await expect(loadList(db, ACC, 'negocios', req('?status=talvez'), ORIGIN, NOW)).rejects.toBeInstanceOf(
      PlatformError,
    )
    await expect(loadList(db, ACC, 'negocios', req('?pipeline=xyz'), ORIGIN, NOW)).rejects.toBeInstanceOf(
      PlatformError,
    )
    await expect(
      loadList(db, ACC, 'agenda', req('?de=2026-11-01&ate=2026-12-15'), ORIGIN, NOW),
    ).rejects.toMatchObject({ code: 'bad_request' })
  })
})

describe('loadMessages', () => {
  it("reads a conversation of the CRM and refuses another CRM's", async () => {
    const { db } = recordingDb(tables())
    const page = await loadMessages(db, ACC, CONV, req())
    expect(page.items).toHaveLength(1)
    await expect(loadMessages(db, ACC, CONV_OTHER, req())).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('loadNovidades', () => {
  it('keeps `desde` within 7 days', () => {
    expect(clampSince('2020-01-01T00:00:00Z', NOW)).toBe(new Date(NOW.getTime() - 7 * 86_400_000).toISOString())
    expect(clampSince(null, NOW)).toBe(ago(1))
    expect(clampSince('2099-01-01T00:00:00Z', NOW)).toBe(NOW.toISOString())
  })

  it('brings leads, closed deals and waiting conversations of this CRM only', async () => {
    const { db } = recordingDb(tables())
    const news = await loadNovidades(db, access('rows'), ago(3), { origin: ORIGIN, now: NOW })
    expect(news.items.map((i) => [i.kind, i.id, i.title])).toEqual([
      ['waiting', CONV, 'Ana'],
      ['deal_won', 'd1', 'Plano anual'],
      ['lead', 'l1', 'Ana'],
    ])
  })

  it('with only Métricas, no names', async () => {
    const { db } = recordingDb(tables())
    const news = await loadNovidades(db, access('metrics'), ago(3), { origin: ORIGIN, now: NOW })
    expect(news.items.every((i) => i.title === null)).toBe(true)
    expect(JSON.stringify(news)).not.toContain('Ana')
  })
})

describe('registerAgencyOsWebhook', () => {
  const saved = process.env.AGENCY_OS_WEBHOOK_URL
  afterEach(() => {
    process.env.AGENCY_OS_WEBHOOK_URL = saved
  })

  it('needs the fixed address configured on the server', async () => {
    delete process.env.AGENCY_OS_WEBHOOK_URL
    const { db } = recordingDb(tables())
    await expect(registerAgencyOsWebhook(db, ACC, 'u1')).rejects.toMatchObject({ code: 'unavailable' })
    process.env.AGENCY_OS_WEBHOOK_URL = 'http://sem-https.test/x'
    await expect(registerAgencyOsWebhook(db, ACC, 'u1')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('creates the lead webhook once, then re-arms it with a new secret', async () => {
    process.env.AGENCY_OS_WEBHOOK_URL = 'https://sistema.test/.netlify/functions/webhook-crm-harpium'
    const t: Record<string, Row[]> = { webhook_endpoints: [] }
    const db = fakePlatformDb(t)
    const first = await registerAgencyOsWebhook(db, ACC, 'u1')
    expect(first).toMatchObject({
      reused: false,
      events: ['lead.received'],
      url: process.env.AGENCY_OS_WEBHOOK_URL,
    })
    expect(first.secret.startsWith('whsec_')).toBe(true)
    expect(t.webhook_endpoints).toHaveLength(1)
    const stored = t.webhook_endpoints[0]
    expect(stored).toMatchObject({ account_id: ACC, url: process.env.AGENCY_OS_WEBHOOK_URL })
    expect(String(stored.secret)).not.toContain(first.secret)

    stored.is_active = false
    stored.failure_count = 9
    const again = await registerAgencyOsWebhook(db, ACC, 'u1')
    expect(again.reused).toBe(true)
    expect(again.secret).not.toBe(first.secret)
    expect(t.webhook_endpoints).toHaveLength(1)
    expect(t.webhook_endpoints[0]).toMatchObject({ is_active: true, failure_count: 0 })
  })
})
