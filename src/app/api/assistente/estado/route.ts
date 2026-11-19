import { NextResponse } from 'next/server'

import { loadAttention } from '@/lib/assistente/attention'
import { fail, readiness, resolve } from '@/lib/assistente/http'
import { HARPI_NAME } from '@/lib/assistente/prompt'

/**
 * GET /api/assistente/estado  (any member)
 *
 * Whether the bot can run here, and what its badge should count. The
 * launcher polls it; before migration 074 it answers `installed:
 * false` and the face stays hidden, so the code can ship first.
 */
export async function GET(request: Request) {
  try {
    const { ctx } = await resolve(new URL(request.url).searchParams.get('tz'))
    const ready = await readiness(ctx)
    if (!ready.ready && ready.reason === 'not_installed') {
      return NextResponse.json({ installed: false })
    }
    const attention = ready.ready ? await loadAttention(ctx).catch(() => []) : []
    return NextResponse.json({
      installed: true,
      name: HARPI_NAME,
      ready: ready.ready,
      reason: ready.ready ? null : ready.reason,
      message: ready.ready ? null : ready.message,
      readOnly: ctx.readOnly,
      role: ctx.role,
      canConfigure: ctx.role === 'owner' || ctx.role === 'admin',
      attention,
    })
  } catch (err) {
    return fail(err)
  }
}
