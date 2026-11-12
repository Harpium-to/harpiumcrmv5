// ============================================================
// Meta Conversions API for a quiz (server side of the Pixel).
//
// When a quiz has a Pixel ID and a Conversions API token, the result of
// each finished visit is also sent from the server, with the same
// event name and the same event id the browser's Pixel used — so Meta
// counts it once, and still gets it when the browser blocks the Pixel.
//
// Contact details go hashed (SHA-256), as Meta asks. The token is kept
// encrypted in quiz_secrets and never leaves the server.
//
// Best-effort: runs after the visitor already has the answer and never
// throws.
// ============================================================

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { contactFrom, type QuizOutcome } from './engine'
import { isMissingTable, type PublishedQuiz } from './store'
import type { SessionRow, VisitContext } from './submit'

const GRAPH = 'https://graph.facebook.com/v21.0'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** The click id as Meta's `fbc` parameter, when only the fbclid is known. */
export function fbcFrom(fbclid: string | undefined, at: Date): string | undefined {
  return fbclid ? `fb.1.${at.getTime()}.${fbclid}` : undefined
}

export interface ConversionInput {
  pixelId: string
  eventName: string
  eventId: string | null
  at: Date
  pageUrl: string | null
  slug: string
  contact: { phone?: string; email?: string; name?: string }
  ip: string | null
  userAgent: string | null
  fbp?: string
  fbc?: string
}

/** The body Meta expects. Pure, so the hashing is easy to check. */
export function buildConversionEvent(input: ConversionInput): Record<string, unknown> {
  const user: Record<string, unknown> = {}
  const phone = (input.contact.phone ?? '').replace(/\D/g, '')
  if (phone) user.ph = [sha256(phone)]
  const email = (input.contact.email ?? '').trim().toLowerCase()
  if (email) user.em = [sha256(email)]
  const first = (input.contact.name ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  if (first) user.fn = [sha256(first)]
  if (input.ip) user.client_ip_address = input.ip
  if (input.userAgent) user.client_user_agent = input.userAgent
  if (input.fbp) user.fbp = input.fbp
  if (input.fbc) user.fbc = input.fbc

  return {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(input.at.getTime() / 1000),
        ...(input.eventId ? { event_id: input.eventId } : {}),
        action_source: 'website',
        ...(input.pageUrl ? { event_source_url: input.pageUrl } : {}),
        user_data: user,
        custom_data: { content_name: input.slug },
      },
    ],
  }
}

async function loadToken(admin: SupabaseClient, quizId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('quiz_secrets')
    .select('capi_token')
    .eq('quiz_id', quizId)
    .maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('[quiz capi] token read failed:', error.message)
    return null
  }
  const stored = (data as { capi_token?: string | null } | null)?.capi_token
  if (!stored) return null
  try {
    return decrypt(stored)
  } catch (err) {
    console.error('[quiz capi] token could not be read:', err)
    return null
  }
}

/** True when the quiz has a Conversions API token saved. */
export async function hasCapiToken(admin: SupabaseClient, quizId: string): Promise<boolean> {
  const { data } = await admin
    .from('quiz_secrets')
    .select('capi_token')
    .eq('quiz_id', quizId)
    .maybeSingle()
  return Boolean((data as { capi_token?: string | null } | null)?.capi_token)
}

/** Save (encrypted) or, with an empty value, remove the token. */
export async function saveCapiToken(
  admin: SupabaseClient,
  quiz: { id: string; accountId: string },
  token: string,
): Promise<void> {
  const clean = token.trim()
  const { error } = await admin.from('quiz_secrets').upsert(
    {
      quiz_id: quiz.id,
      account_id: quiz.accountId,
      capi_token: clean ? encrypt(clean) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'quiz_id' },
  )
  if (error) throw new Error(error.message)
}

export async function sendConversion(
  admin: SupabaseClient,
  args: { quiz: PublishedQuiz; session: SessionRow; outcome: QuizOutcome; context: VisitContext },
): Promise<void> {
  try {
    const { quiz, session, outcome, context } = args
    const pixelId = quiz.definition.settings.pixelId
    const pixel = outcome.result.pixel
    if (!pixelId || pixel.kind === 'none' || !pixel.name) return
    const token = await loadToken(admin, quiz.id)
    if (!token) return

    const now = new Date()
    const meta = session.meta ?? {}
    const body = buildConversionEvent({
      pixelId,
      eventName: pixel.name,
      eventId: session.event_id,
      at: now,
      pageUrl: context.pageUrl,
      slug: quiz.slug,
      contact: contactFrom(quiz.definition, session.answers),
      ip: context.ip,
      userAgent: context.userAgent,
      fbp: typeof meta.fbp === 'string' ? meta.fbp : undefined,
      fbc: typeof meta.fbc === 'string' ? meta.fbc : fbcFrom(session.utms?.fbclid, now),
    })

    const res = await fetch(`${GRAPH}/${encodeURIComponent(pixelId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // In the body, not the address, so the token stays out of URL logs.
      body: JSON.stringify({ ...body, access_token: token }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[quiz capi] Meta refused the event:', res.status, detail.slice(0, 300))
    }
  } catch (err) {
    console.error('[quiz capi] send failed:', err)
  }
}
