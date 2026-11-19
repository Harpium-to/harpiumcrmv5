import { NextResponse } from 'next/server'

import { ForbiddenError, UnauthorizedError, getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

import { contextFor, checkReadiness, type Readiness } from './session'
import { NotInstalledError } from './store'
import { ToolError, type ToolContext } from './types'

// ============================================================
// Shared plumbing for /api/assistente/*.
// Every route: who is asking (any member — viewers only read), the
// person's zone, and whether the assistant can run in this CRM.
// ============================================================

/** Per person: messages typed, and model turns (a message is ~1–6). */
export const LIMITS = {
  message: { limit: 30, windowMs: 10 * 60_000 },
  step: { limit: 60, windowMs: 60_000 },
  /** The whole CRM, across people: bounds spend on its one key. */
  accountStep: { limit: 150, windowMs: 60_000 },
} as const

export interface Resolved {
  ctx: ToolContext
}

export async function resolve(timezone?: string | null): Promise<Resolved> {
  const account = await getCurrentAccount()
  return { ctx: await contextFor(account, timezone) }
}

export function rateLimit(
  ctx: ToolContext,
  kind: 'message' | 'step',
): NextResponse | null {
  const own = checkRateLimit(`assistente-${kind}:${ctx.userId}`, LIMITS[kind])
  if (!own.success) return rateLimitResponse(own)
  if (kind === 'step') {
    const team = checkRateLimit(`assistente-step-account:${ctx.accountId}`, LIMITS.accountStep)
    if (!team.success) return rateLimitResponse(team)
  }
  return null
}

export function notReady(r: Exclude<Readiness, { ready: true }>): NextResponse {
  return NextResponse.json({ error: r.message, reason: r.reason }, { status: 409 })
}

export async function readiness(ctx: ToolContext): Promise<Readiness> {
  return checkReadiness(ctx.db, ctx.accountId)
}

export function fail(err: unknown): NextResponse {
  if (err instanceof ToolError) return NextResponse.json({ error: err.message }, { status: 400 })
  if (err instanceof NotInstalledError) {
    return NextResponse.json({ error: err.message, reason: 'not_installed' }, { status: 409 })
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) return toErrorResponse(err)
  console.error('[assistente] route failed:', err)
  return NextResponse.json({ error: 'Algo deu errado no Harpi. Tente de novo.' }, { status: 500 })
}

/** The browser's zone, checked later by safeZone. */
export function zoneFrom(body: Record<string, unknown> | null, request: Request): string | null {
  const fromBody = typeof body?.timezone === 'string' ? body.timezone : null
  return fromBody ?? new URL(request.url).searchParams.get('tz')
}
