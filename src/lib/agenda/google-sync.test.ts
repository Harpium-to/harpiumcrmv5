import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { GoogleApiError } from '@/lib/google/calendar-api'
import { GoogleAuthError } from '@/lib/google/oauth'

import { googleEventIdFor, type ClaimedGoogleSync } from './google-event'
import { describeGoogleFailure, processGoogleCalendarSync, type GoogleSyncDeps } from './google-sync'

const EVENT = '3f2b9c1e-0a4d-4e8f-9b7a-1c2d3e4f5a6b'
const NOW = new Date('2030-01-07T10:00:00Z')

function claimed(patch: Partial<ClaimedGoogleSync> = {}): ClaimedGoogleSync {
  return {
    event_id: EVENT,
    claimed_at: '2030-01-07T10:00:00.123456+00:00',
    account_id: 'acc',
    calendar_id: 'cal',
    kind: 'appointment',
    status: 'scheduled',
    title: 'Consulta',
    notes: null,
    starts_at: '2030-01-08T12:00:00+00:00',
    ends_at: '2030-01-08T12:30:00+00:00',
    contact_id: 'ct1',
    contact_name: 'Maria',
    contact_phone: '+5563999990000',
    google_event_id: null,
    google_calendar_id: null,
    google_connection_id: null,
    google_sync_attempts: 0,
    calendar_name: 'Dr. João',
    timezone: 'America/Sao_Paulo',
    target_connection_id: 'conn',
    target_calendar_id: 'dr@clinica.com',
    target_connection_status: 'connected',
    ...patch,
  }
}

interface Deletion {
  id: string
  connection_id: string
  google_calendar_id: string
  google_event_id: string
  attempts: number
}

/** Enough of the service-role client for the sender. */
function fakeDb(world: {
  claim?: ClaimedGoogleSync[]
  deletions?: Deletion[]
  missing?: 'table' | 'function'
}) {
  const finished: Record<string, unknown>[] = []
  const deletionUpdates: Record<string, unknown>[] = []
  const deleted: string[] = []
  const claimArgs: Record<string, unknown>[] = []

  const from = (table: string) => {
    if (table !== 'google_event_deletions') throw new Error(`unexpected table ${table}`)
    let op: 'select' | 'delete' | 'update' = 'select'
    let patch: Record<string, unknown> = {}
    const chain = {
      select: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () =>
        Promise.resolve(
          world.missing === 'table'
            ? { data: null, error: { code: '42P01' } }
            : { data: world.deletions ?? [], error: null },
        ),
      delete: () => {
        op = 'delete'
        return chain
      },
      update: (values: Record<string, unknown>) => {
        op = 'update'
        patch = values
        return chain
      },
      eq: (_col: string, id: string) => {
        if (op === 'delete') deleted.push(id)
        if (op === 'update') deletionUpdates.push({ id, ...patch })
        return Promise.resolve({ error: null })
      },
    }
    return chain
  }

  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_google_event_sync') {
      claimArgs.push(args)
      if (world.missing === 'function') return { data: null, error: { code: 'PGRST202' } }
      return { data: world.claim ?? [], error: null }
    }
    if (name === 'finish_google_event_sync') {
      finished.push(args)
      return { data: null, error: null }
    }
    throw new Error(`unexpected rpc ${name}`)
  }

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    finished,
    deletionUpdates,
    deleted,
    claimArgs,
  }
}

function deps(patch: Partial<GoogleSyncDeps> = {}): GoogleSyncDeps & {
  put: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  token: ReturnType<typeof vi.fn>
} {
  return {
    config: () => ({ clientId: 'cid', clientSecret: 'secret' }),
    token: vi.fn(async (_db: SupabaseClient, connectionId: string) => `token-${connectionId}`),
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    now: () => NOW,
    ...patch,
  } as never
}

describe('processGoogleCalendarSync', () => {
  it('does nothing — and claims nothing — while the server has no Google credentials', async () => {
    const world = fakeDb({ claim: [claimed()] })
    const d = deps({ config: () => null })
    expect(await processGoogleCalendarSync(world.db, {}, d)).toBeNull()
    expect(world.claimArgs).toEqual([])
  })

  it('does nothing before migration 069', async () => {
    expect(await processGoogleCalendarSync(fakeDb({ missing: 'table' }).db, {}, deps())).toBeNull()
    expect(
      await processGoogleCalendarSync(fakeDb({ missing: 'function' }).db, { eventId: EVENT }, deps()),
    ).toBeNull()
  })

  it('creates a new event in the agenda’s Google calendar and records where', async () => {
    const world = fakeDb({ claim: [claimed()] })
    const d = deps()
    const counts = await processGoogleCalendarSync(world.db, { crmUrl: 'https://crm.test/' }, d)
    expect(counts).toEqual({ sent: 1, removed: 0, failed: 0 })

    const id = googleEventIdFor(EVENT, 'dr@clinica.com')
    expect(d.put).toHaveBeenCalledTimes(1)
    const [token, calendarId, eventId, body, opts] = d.put.mock.calls[0]
    expect([token, calendarId, eventId, opts]).toEqual(['token-conn', 'dr@clinica.com', id, { exists: false }])
    expect((body as { description: string }).description).toContain('https://crm.test/contacts?contact=ct1')

    expect(world.finished).toEqual([
      {
        p_event_id: EVENT,
        p_claimed_at: '2030-01-07T10:00:00.123456+00:00',
        p_google_event_id: id,
        p_google_calendar_id: 'dr@clinica.com',
        p_connection_id: 'conn',
        p_error: null,
        p_retry: true,
      },
    ])
  })

  it('a cancelled event is removed from Google and forgotten', async () => {
    const world = fakeDb({
      claim: [
        claimed({
          status: 'cancelled',
          google_event_id: 'hcold',
          google_calendar_id: 'dr@clinica.com',
          google_connection_id: 'conn',
        }),
      ],
    })
    const d = deps()
    expect(await processGoogleCalendarSync(world.db, { eventId: EVENT }, d)).toEqual({
      sent: 0,
      removed: 1,
      failed: 0,
    })
    expect(d.remove).toHaveBeenCalledWith('token-conn', 'dr@clinica.com', 'hcold')
    expect(d.put).not.toHaveBeenCalled()
    expect(world.finished[0]).toMatchObject({ p_google_event_id: null, p_error: null })
  })

  it('moved to an agenda on another account: removed there with that account, created here', async () => {
    const world = fakeDb({
      claim: [
        claimed({
          google_event_id: 'hcold',
          google_calendar_id: 'primary',
          google_connection_id: 'other',
        }),
      ],
    })
    const d = deps()
    await processGoogleCalendarSync(world.db, { eventId: EVENT }, d)
    expect(d.remove).toHaveBeenCalledWith('token-other', 'primary', 'hcold')
    expect(d.put.mock.calls[0][0]).toBe('token-conn')
    expect(world.finished[0]).toMatchObject({ p_connection_id: 'conn', p_error: null })
  })

  it('an account that needs signing in again: nothing sent, the reason recorded, no retry', async () => {
    const world = fakeDb({ claim: [claimed({ target_connection_status: 'needs_reconnect' })] })
    const d = deps()
    expect(await processGoogleCalendarSync(world.db, { eventId: EVENT }, d)).toEqual({
      sent: 0,
      removed: 0,
      failed: 1,
    })
    expect(d.put).not.toHaveBeenCalled()
    expect(world.finished[0]).toMatchObject({
      p_error: 'A conta Google desta agenda precisa ser conectada de novo.',
      p_retry: false,
    })
  })

  it('Google busy: the event keeps where it was and is retried later', async () => {
    const world = fakeDb({
      claim: [claimed({ google_event_id: 'hc1', google_calendar_id: 'dr@clinica.com', google_connection_id: 'conn' })],
    })
    const d = deps({ put: vi.fn(async () => Promise.reject(new GoogleApiError('busy', 503))) as never })
    await processGoogleCalendarSync(world.db, { eventId: EVENT }, d)
    expect(world.finished[0]).toMatchObject({
      p_google_event_id: 'hc1',
      p_google_calendar_id: 'dr@clinica.com',
      p_retry: true,
    })
  })

  it('one token per account per run, even for many events', async () => {
    const world = fakeDb({
      claim: [claimed(), claimed({ event_id: '11111111-1111-4111-8111-111111111111' })],
    })
    const d = deps()
    await processGoogleCalendarSync(world.db, {}, d)
    expect(d.token).toHaveBeenCalledTimes(1)
    expect(d.put).toHaveBeenCalledTimes(2)
  })

  it('deleted in the CRM: removed from Google; a busy Google is retried later; a lost access is dropped', async () => {
    const world = fakeDb({
      deletions: [
        { id: 'd1', connection_id: 'conn', google_calendar_id: 'primary', google_event_id: 'hc1', attempts: 0 },
        { id: 'd2', connection_id: 'busy', google_calendar_id: 'primary', google_event_id: 'hc2', attempts: 1 },
        { id: 'd3', connection_id: 'gone', google_calendar_id: 'primary', google_event_id: 'hc3', attempts: 0 },
      ],
    })
    const d = deps({
      token: vi.fn(async (_db: SupabaseClient, connectionId: string) => {
        if (connectionId === 'gone') throw new GoogleAuthError('revoked', 'invalid_grant', true)
        return `token-${connectionId}`
      }) as never,
      remove: vi.fn(async (token: string) => {
        if (token === 'token-busy') throw new GoogleApiError('busy', 503)
      }) as never,
    })
    const counts = await processGoogleCalendarSync(world.db, {}, d)
    expect(counts).toEqual({ sent: 0, removed: 1, failed: 2 })
    expect(world.deleted.sort()).toEqual(['d1', 'd3'])
    expect(world.deletionUpdates).toEqual([
      expect.objectContaining({ id: 'd2', attempts: 2, next_at: '2030-01-07T10:04:00.000Z' }),
    ])
  })
})

describe('describeGoogleFailure', () => {
  it('says what the agenda screen should show, and whether it passes on its own', () => {
    expect(describeGoogleFailure(new GoogleAuthError('x', 'invalid_grant', true))).toEqual({
      message: 'A conta Google desta agenda precisa ser conectada de novo.',
      retry: false,
    })
    expect(describeGoogleFailure(new GoogleApiError('x', 429)).retry).toBe(true)
    expect(describeGoogleFailure(new GoogleApiError('x', 403, 'rateLimitExceeded')).retry).toBe(true)
    expect(describeGoogleFailure(new GoogleApiError('x', 403, 'forbidden')).retry).toBe(false)
    expect(describeGoogleFailure(new GoogleApiError('x', 404)).message).toContain('não existe mais')
    expect(describeGoogleFailure(new GoogleApiError('x', 400)).retry).toBe(false)
  })
})
