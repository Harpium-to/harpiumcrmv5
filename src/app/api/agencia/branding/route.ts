import { NextResponse } from 'next/server'

import { requireAgencia } from '@/lib/agencia/guard'
import { toErrorResponse } from '@/lib/auth/account'

// Update the global brand (name + logo). Agency-only. The single
// app_branding row (id = TRUE) is created by migration 041.
export async function PUT(request: Request) {
  try {
    const { admin } = await requireAgencia()
    const body = await request.json().catch(() => ({}))
    const name =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim()
        : null
    const logoUrl =
      typeof body?.logoUrl === 'string' && body.logoUrl.trim()
        ? body.logoUrl.trim()
        : null

    const { error } = await admin
      .from('app_branding')
      .update({ name, logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', true)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
