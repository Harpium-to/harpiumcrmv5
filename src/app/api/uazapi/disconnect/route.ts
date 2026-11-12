import { NextResponse } from 'next/server'

import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { disconnectUazapiInstance } from '@/lib/uazapi/api'
import { decrypt } from '@/lib/whatsapp/encryption'

// End the WhatsApp session of the account's UAZAPI instance (D1). The
// phone shows it as a removed linked device; connecting again needs a
// new QR. The instance and its token stay, so reconnecting doesn't
// create another one. Admins+ only, like connecting.
export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const admin = supabaseAdmin()
    const { data: cfg } = await admin
      .from('uazapi_config')
      .select('base_url, instance_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!cfg?.base_url || !cfg.instance_token) {
      return NextResponse.json({ error: 'Nenhum WhatsApp conectado por QR code.' }, { status: 400 })
    }

    await disconnectUazapiInstance({ baseUrl: cfg.base_url, token: decrypt(cfg.instance_token) })

    await admin
      .from('uazapi_config')
      .update({ status: 'disconnected', paired_phone: null, updated_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return toErrorResponse(err)
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
