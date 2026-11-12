// ============================================================
// The few Google Calendar API calls the Agenda makes (G1): list the
// calendars an account owns, and put / delete one event.
//
// Plain fetch, an access token per call (lib/google/tokens.ts keeps it
// fresh). Every failure comes back as a GoogleApiError with the HTTP
// status, so the sender can tell "try again later" (429, 5xx, network)
// from "this will not work until someone acts" (401/403, 400).
// ============================================================

const API = 'https://www.googleapis.com/calendar/v3'
const TIMEOUT_MS = 10_000

type FetchLike = typeof fetch

export class GoogleApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when Google could not be reached. */
    readonly status: number,
    /** Google's own reason, e.g. "duplicate", "notFound", "rateLimitExceeded". */
    readonly reason: string | null = null,
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }

  /** Worth trying again on its own: Google was busy or unreachable. */
  get retryable(): boolean {
    return (
      this.status === 0 ||
      this.status === 429 ||
      this.status >= 500 ||
      (this.status === 403 && /rateLimit/i.test(this.reason ?? ''))
    )
  }
}

async function call(
  token: string,
  method: string,
  path: string,
  fetchImpl: FetchLike,
  body?: unknown,
): Promise<Record<string, unknown> | null> {
  let response: Response
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new GoogleApiError('Não consegui falar com o Google.', 0)
  }
  if (response.status === 204) return null
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    const error = (json?.error ?? {}) as { message?: unknown; errors?: { reason?: unknown }[] }
    const reason = typeof error.errors?.[0]?.reason === 'string' ? error.errors[0].reason : null
    const message = typeof error.message === 'string' ? error.message : `HTTP ${response.status}`
    throw new GoogleApiError(message, response.status, reason)
  }
  return json
}

export interface GoogleCalendarEntry {
  id: string
  name: string
  primary: boolean
}

/**
 * The calendars this account owns — the only ones `calendar.events.owned`
 * lets the CRM write to. The primary one first.
 */
export async function listOwnedCalendars(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleCalendarEntry[]> {
  const out: GoogleCalendarEntry[] = []
  let pageToken: string | null = null
  // A person with hundreds of calendars is not a case worth paging forever.
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ minAccessRole: 'owner', maxResults: '250' })
    if (pageToken) query.set('pageToken', pageToken)
    const json = await call(token, 'GET', `/users/me/calendarList?${query}`, fetchImpl)
    const items = Array.isArray(json?.items) ? (json.items as Record<string, unknown>[]) : []
    for (const item of items) {
      if (typeof item.id !== 'string' || item.deleted === true) continue
      const name =
        (typeof item.summaryOverride === 'string' && item.summaryOverride) ||
        (typeof item.summary === 'string' && item.summary) ||
        item.id
      out.push({ id: item.id, name, primary: item.primary === true })
    }
    pageToken = typeof json?.nextPageToken === 'string' ? json.nextPageToken : null
    if (!pageToken) break
  }
  return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name))
}

/** The body of an event, as the CRM writes it (lib/agenda/google-event.ts). */
export type GoogleEventBody = Record<string, unknown>

const eventPath = (calendarId: string, eventId?: string) =>
  `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`

/**
 * Create or update the event with this id. The id is the CRM's own
 * (lib/agenda/google-event.ts), so this is safe to repeat: a run that
 * died after Google answered does not leave a duplicate behind.
 *
 *   update first when it should exist; gone (404/410) → create;
 *   create answered "already exists" (409, e.g. deleted earlier, which
 *   Google keeps as cancelled) → update, which brings it back.
 */
export async function putGoogleEvent(
  token: string,
  calendarId: string,
  eventId: string,
  body: GoogleEventBody,
  opts: { exists: boolean },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const update = () =>
    call(token, 'PUT', `${eventPath(calendarId, eventId)}?sendUpdates=none`, fetchImpl, body)
  const insert = () =>
    call(token, 'POST', `${eventPath(calendarId)}?sendUpdates=none`, fetchImpl, { ...body, id: eventId })

  if (opts.exists) {
    try {
      await update()
      return
    } catch (error) {
      if (!(error instanceof GoogleApiError) || (error.status !== 404 && error.status !== 410)) throw error
    }
  }
  try {
    await insert()
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 409) {
      await update()
      return
    }
    throw error
  }
}

/** Remove the event. Already gone counts as done. */
export async function deleteGoogleEvent(
  token: string,
  calendarId: string,
  eventId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  try {
    await call(token, 'DELETE', `${eventPath(calendarId, eventId)}?sendUpdates=none`, fetchImpl)
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return
    throw error
  }
}
