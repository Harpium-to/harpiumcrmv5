import { NextResponse } from 'next/server'

import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { importHistoryPage } from '@/lib/uazapi/history'
import { decrypt } from '@/lib/whatsapp/encryption'

// Bring the phone's old 1:1 chats into the CRM (QR-code path), one page
// of chats per call: `{ offset }` in, `next_offset` out until null. The
// screen loops; every call is short, so no request outlives the host's
// time limit. Admins only. See src/lib/uazapi/history.ts for what is
// (and isn't) copied.

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    if (ctx.status === 'suspended') {
      return NextResponse.json({ error: 'CRM suspenso: só leitura.' }, { status: 403 })
    }
    const body = (await request.json().catch(() => ({}))) as { offset?: unknown }
    const offset =
      typeof body.offset === 'number' && Number.isInteger(body.offset) && body.offset >= 0
        ? body.offset
        : 0

    const admin = supabaseAdmin()
    const [{ data: cfg }, { data: acc }] = await Promise.all([
      admin
        .from('uazapi_config')
        .select('base_url, instance_token, status')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      admin.from('accounts').select('owner_user_id').eq('id', ctx.accountId).maybeSingle(),
    ])
    const row = cfg as { base_url: string | null; instance_token: string | null; status: string | null } | null
    if (!row?.base_url || !row.instance_token) {
      return NextResponse.json(
        { error: 'Conecte o WhatsApp por QR code antes de trazer as conversas.' },
        { status: 400 },
      )
    }
    const ownerUserId = (acc as { owner_user_id?: string } | null)?.owner_user_id
    if (!ownerUserId) {
      return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 500 })
    }

    const result = await importHistoryPage(
      admin,
      { id: ctx.accountId, ownerUserId },
      { baseUrl: row.base_url, token: decrypt(row.instance_token) },
      offset,
    )
    return NextResponse.json({
      ok: true,
      chats: result.chats,
      imported: result.imported,
      contacts_created: result.contactsCreated,
      next_offset: result.nextOffset,
    })
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return toErrorResponse(err)
    }
    // Anything else came from UAZAPI or the database.
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
