// ============================================================
// POST /api/extrator/{id}/whatsapp — check the next numbers of the
// extraction on WhatsApp, through the number connected by QR code.
// The screen calls it until `remaining` is 0. Admins only.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getExtraction } from '@/lib/extractor/store'
import { checkNextNumbers, whatsappCheckAvailability } from '@/lib/extractor/whatsapp'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const extraction = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!extraction) return NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })
    const admin = supabaseAdmin()
    const availability = await whatsappCheckAvailability(admin, ctx.accountId)
    if (!availability.available) {
      return NextResponse.json({ error: availability.reason }, { status: 409 })
    }
    try {
      return NextResponse.json(await checkNextNumbers(admin, ctx.accountId, id, availability.server))
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Não consegui conferir os números.' },
        { status: 502 },
      )
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
