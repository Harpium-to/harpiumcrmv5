import { describe, expect, it, vi } from 'vitest'

import { deleteGoogleEvent, GoogleApiError, listOwnedCalendars, putGoogleEvent } from './calendar-api'

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

/** A fetch that answers the queued responses in order and records the calls. */
function scripted(...answers: Response[]) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const next = answers.shift()
    if (!next) throw new Error('unexpected call')
    return next
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const notFound = () => respond(404, { error: { message: 'Not Found', errors: [{ reason: 'notFound' }] } })

describe('listOwnedCalendars', () => {
  it('asks only for owned calendars, primary first, deleted ones out', async () => {
    const { fetchImpl, calls } = scripted(
      respond(200, {
        items: [
          { id: 'b@group', summary: 'Retornos' },
          { id: 'dr@clinica.com', summary: 'dr@clinica.com', primary: true },
          { id: 'old@group', summary: 'Antiga', deleted: true },
          { id: 'a@group', summary: 'Pessoal', summaryOverride: 'Minha pessoal' },
        ],
      }),
    )
    expect(await listOwnedCalendars('tok', fetchImpl)).toEqual([
      { id: 'dr@clinica.com', name: 'dr@clinica.com', primary: true },
      { id: 'a@group', name: 'Minha pessoal', primary: false },
      { id: 'b@group', name: 'Retornos', primary: false },
    ])
    expect(calls[0].url).toContain('minAccessRole=owner')
  })
})

describe('putGoogleEvent', () => {
  const body = { summary: 'Consulta' }

  it('creates with the CRM’s own id and never notifies anyone', async () => {
    const { fetchImpl, calls } = scripted(respond(200, { id: 'hc1' }))
    await putGoogleEvent('tok', 'primary', 'hc1', body, { exists: false }, fetchImpl)
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
    )
    expect(calls[0].body).toEqual({ summary: 'Consulta', id: 'hc1' })
  })

  it('an existing one is updated in place', async () => {
    const { fetchImpl, calls } = scripted(respond(200, { id: 'hc1' }))
    await putGoogleEvent('tok', 'dr@clinica.com', 'hc1', body, { exists: true }, fetchImpl)
    expect(calls.map((c) => c.method)).toEqual(['PUT'])
    expect(calls[0].url).toContain('/calendars/dr%40clinica.com/events/hc1?sendUpdates=none')
  })

  it('updating one deleted in Google creates it again', async () => {
    const { fetchImpl, calls } = scripted(notFound(), respond(200, { id: 'hc1' }))
    await putGoogleEvent('tok', 'primary', 'hc1', body, { exists: true }, fetchImpl)
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'POST'])
  })

  it('creating one Google already has (a run that died midway) updates it instead', async () => {
    const { fetchImpl, calls } = scripted(
      respond(409, { error: { message: 'duplicate', errors: [{ reason: 'duplicate' }] } }),
      respond(200, { id: 'hc1' }),
    )
    await putGoogleEvent('tok', 'primary', 'hc1', body, { exists: false }, fetchImpl)
    expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT'])
  })

  it('other failures come back typed, with whether to retry', async () => {
    const { fetchImpl } = scripted(respond(503, { error: { message: 'busy' } }))
    const error = await putGoogleEvent('tok', 'primary', 'hc1', body, { exists: false }, fetchImpl).catch(
      (e) => e,
    )
    expect(error).toBeInstanceOf(GoogleApiError)
    expect(error.status).toBe(503)
    expect(error.retryable).toBe(true)

    const forbidden = scripted(respond(403, { error: { message: 'no', errors: [{ reason: 'forbidden' }] } }))
    const denied = await putGoogleEvent('tok', 'x', 'hc1', body, { exists: false }, forbidden.fetchImpl).catch(
      (e) => e,
    )
    expect(denied.retryable).toBe(false)
  })
})

describe('deleteGoogleEvent', () => {
  it('already gone counts as done', async () => {
    const { fetchImpl } = scripted(respond(410, { error: { message: 'Gone' } }))
    await expect(deleteGoogleEvent('tok', 'primary', 'hc1', fetchImpl)).resolves.toBeUndefined()
  })

  it('a 204 is done; a 500 is thrown to retry', async () => {
    const ok = scripted(respond(204))
    await expect(deleteGoogleEvent('tok', 'primary', 'hc1', ok.fetchImpl)).resolves.toBeUndefined()
    const busy = scripted(respond(500, { error: { message: 'oops' } }))
    await expect(deleteGoogleEvent('tok', 'primary', 'hc1', busy.fetchImpl)).rejects.toBeInstanceOf(
      GoogleApiError,
    )
  })
})
