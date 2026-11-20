import { describe, expect, it } from 'vitest'

import { fakeDb, type Row } from '@/lib/leads/fake-db.test-helper'

import { runExtractionSlice, runPendingExtractions, type RunDeps, type SourceRegistry } from './run'
import type { SourceAdapter } from './sources/types'
import type { ExtractedLead } from './types'

const ACC = 'acc-1'
const NOW = Date.parse('2026-11-17T13:00:00Z')

const lead = (key: string, phone: string | null, over: Partial<ExtractedLead> = {}): ExtractedLead => ({
  source: 'cnpj',
  externalKey: key,
  kind: 'empresa',
  name: `Empresa ${key}`,
  phone,
  email: null,
  website: null,
  instagram: null,
  address: null,
  district: null,
  city: 'Goiania',
  uf: 'GO',
  cep: null,
  activity: 'Atividade odontológica',
  extras: {},
  ...over,
})

/** A source that hands out `pages` one per call. */
function pagedSource(pages: ExtractedLead[][]): SourceAdapter<unknown> {
  let i = 0
  return {
    available: () => ({ available: true }),
    async fetchPage() {
      const leads = pages[i] ?? []
      i += 1
      return { leads, fetched: leads.length, cursor: i < pages.length ? { apos: String(i) } : null, costUsd: 0, waiting: false }
    },
  }
}

function deps(cnpj: SourceAdapter<unknown>): RunDeps {
  return { sources: { cnpj, google_maps: cnpj } as unknown as SourceRegistry, now: () => NOW }
}

function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    lead_extractions: [
      {
        id: 'ex-1',
        account_id: ACC,
        name: 'Dentistas',
        source: 'cnpj',
        filters: { tipo: 'todos', cnaes: ['8630504'] },
        status: 'queued',
        requested: 3,
        fetched: 0,
        found: 0,
        cursor: {},
        claimed_at: null,
        cost_usd: 0,
        created_at: '2026-11-17T12:00:00Z',
      },
    ],
    lead_extraction_results: [],
    contacts: [{ id: 'c-1', account_id: ACC, phone: '+5562999990002', phone_normalized: '5562999990002' }],
    prospecting_blocklist: [{ account_id: ACC, phone_normalized: '5562999990003' }],
    ...over,
  } as Record<string, Row[]>
}

describe('runExtractionSlice', () => {
  it('writes each lead with what it is against the CRM, then finishes', async () => {
    const t = world()
    const source = pagedSource([
      [
        lead('11111111000100', '+5562999990001'),
        lead('22222222000100', '+5562999990002'),
        lead('33333333000100', '+5562999990003'),
        lead('44444444000100', null),
      ],
    ])
    const job = await runExtractionSlice(fakeDb(t), 'ex-1', deps(source))
    expect(job).toMatchObject({ status: 'done', found: 3, fetched: 4, claimed_at: null })
    const byKey = Object.fromEntries(t.lead_extraction_results.map((r) => [r.external_key, r]))
    expect(byKey['11111111000100']).toMatchObject({ status: 'novo', phone_normalized: '5562999990001', phone_kind: 'celular' })
    expect(byKey['22222222000100']).toMatchObject({ status: 'contato', matched_contact_id: 'c-1' })
    expect(byKey['33333333000100']).toMatchObject({ status: 'bloqueado' })
    // The fourth did not fit in the 3 asked for.
    expect(byKey['44444444000100']).toBeUndefined()
  })

  it('a second row with the same number is not new', async () => {
    const t = world()
    const source = pagedSource([[lead('11111111000100', '+5562999990001'), lead('11111111000281', '+5562999990001')]])
    await runExtractionSlice(fakeDb(t), 'ex-1', deps(source))
    expect(t.lead_extraction_results.map((r) => r.status)).toEqual(['novo', 'extraido'])
  })

  it('goes slice by slice and remembers where it stopped', async () => {
    const t = world()
    t.lead_extractions[0].requested = 10
    const source = pagedSource([[lead('1', '+5562999990001')], [lead('2', '+5562999990004')]])
    const first = await runExtractionSlice(fakeDb(t), 'ex-1', deps(source))
    expect(first).toMatchObject({ status: 'running', found: 1, cursor: { apos: '1' } })
    const second = await runExtractionSlice(fakeDb(t), 'ex-1', deps(source))
    expect(second).toMatchObject({ status: 'done', found: 2 })
  })

  it('does not run a job someone else holds, nor one that is over', async () => {
    const t = world()
    t.lead_extractions[0].claimed_at = new Date(NOW - 10_000).toISOString()
    expect(await runExtractionSlice(fakeDb(t), 'ex-1', deps(pagedSource([[]])))).toBeNull()
    // A claim older than 90 s is a slice that died.
    t.lead_extractions[0].claimed_at = new Date(NOW - 120_000).toISOString()
    expect(await runExtractionSlice(fakeDb(t), 'ex-1', deps(pagedSource([[]])))).toMatchObject({ status: 'done' })
    expect(await runExtractionSlice(fakeDb(t), 'ex-1', deps(pagedSource([[]])))).toBeNull()
  })

  it('waits while the source is still working', async () => {
    const t = world()
    const waiting: SourceAdapter<unknown> = {
      available: () => ({ available: true }),
      fetchPage: async () => ({ leads: [], fetched: 0, cursor: { pedido: 'r-1' }, costUsd: 0, waiting: true }),
    }
    const job = await runExtractionSlice(fakeDb(t), 'ex-1', deps(waiting))
    expect(job).toMatchObject({ status: 'running', cursor: { pedido: 'r-1' }, found: 0, claimed_at: null })
  })

  it('writes the failure on the job for the person', async () => {
    const t = world()
    const broken: SourceAdapter<unknown> = {
      available: () => ({ available: true }),
      fetchPage: async () => {
        throw new Error('A base de CNPJ não respondeu: timeout')
      },
    }
    const job = await runExtractionSlice(fakeDb(t), 'ex-1', deps(broken))
    expect(job).toMatchObject({ status: 'failed', error: 'A base de CNPJ não respondeu: timeout' })
    const off: SourceAdapter<unknown> = {
      available: () => ({ available: false, reason: 'Não conectada.' }),
      fetchPage: async () => ({ leads: [], fetched: 0, cursor: null, costUsd: 0, waiting: false }),
    }
    const t2 = world()
    expect(await runExtractionSlice(fakeDb(t2), 'ex-1', deps(off))).toMatchObject({ status: 'failed', error: 'Não conectada.' })
  })

  it('the scheduler advances what is still going', async () => {
    const t = world()
    expect(await runPendingExtractions(fakeDb(t), {}, deps(pagedSource([[lead('1', '+5562999990001')]])))).toBe(1)
    expect(t.lead_extractions[0].status).toBe('done')
  })

  it('the scheduler starts no slice after its time is up', async () => {
    const t = world()
    t.lead_extractions.push({ ...t.lead_extractions[0], id: 'ex-2', created_at: '2026-11-17T12:30:00Z' })
    let clock = NOW
    // Each page takes 5 s; the scheduler has 3.
    const slow: SourceAdapter<unknown> = {
      available: () => ({ available: true }),
      async fetchPage() {
        clock += 5_000
        return { leads: [], fetched: 0, cursor: null, costUsd: 0, waiting: false }
      },
    }
    const timed: RunDeps = { sources: { cnpj: slow, google_maps: slow } as unknown as SourceRegistry, now: () => clock }
    expect(await runPendingExtractions(fakeDb(t), { deadline: NOW + 3_000 }, timed)).toBe(1)
    expect(t.lead_extractions.map((r) => [r.id, r.status])).toEqual([
      ['ex-1', 'done'],
      ['ex-2', 'queued'],
    ])
  })
})
