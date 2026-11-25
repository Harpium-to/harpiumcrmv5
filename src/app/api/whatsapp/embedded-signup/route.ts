import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/whatsapp/admin-client'
import { getEmbeddedSignupSettings } from '@/lib/whatsapp/embedded-signup'
import { finishEmbeddedSignup } from '@/lib/whatsapp/finish-embedded-signup'

/**
 * GET /api/whatsapp/embedded-signup
 *
 * What the settings screen needs to decide between the "Conectar com
 * o Facebook" button and the manual form. Nothing secret: the app id
 * and the configuration id are public by design (they go to the
 * Facebook SDK in the browser).
 */
export async function GET() {
  try {
    const { role } = await requireRole('viewer')
    const settings = getEmbeddedSignupSettings()
    return NextResponse.json({
      enabled: settings !== null,
      app_id: settings?.appId ?? null,
      config_id: settings?.configId ?? null,
      graph_version: settings?.graphVersion ?? null,
      can_manage: hasMinRole(role, 'admin'),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/whatsapp/embedded-signup
 *   { code, waba_id?, phone_number_id?, business_id?, mode?, event? }
 *
 * Finishes a connection after an admin completes Meta's popup. The
 * steps live in lib/whatsapp/finish-embedded-signup.ts, shared with
 * the connect link that works without login (migration 081).
 *
 * Template sync is left to the browser right after this returns: it's
 * an existing authenticated route and a slow sync shouldn't hold the
 * connection hostage.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`wa-embedded-signup:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const result = await finishEmbeddedSignup({
      db: supabase,
      admin: supabaseAdmin(),
      accountId,
      userId,
      body,
    })
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    return toErrorResponse(err)
  }
}
