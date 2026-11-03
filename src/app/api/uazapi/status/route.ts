import { NextResponse } from 'next/server'

import {
  ForbiddenError,
  UnauthorizedError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getUazapiStatus } from '@/lib/uazapi/api'

// Live pairing state for the account's UAZAPI instance, including the QR
// while it is connecting — the UI polls this after hitting /connect.
//
// Any member may read it (it is the channel's health, which the inbox
// depends on), but the instance token stays server-side: only the
// rendered QR and the paired number come back.
export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    const admin = supabaseAdmin()
    const { data: cfg } = await admin
      .from('uazapi_config')
      .select('base_url, instance_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (!cfg?.base_url || !cfg.instance_token) {
      return NextResponse.json({
        configured: false,
        status: 'disconnected',
        connected: false,
        qrcode: null,
        paircode: null,
        phone: null,
        profileName: null,
      })
    }

    const live = await getUazapiStatus({
      baseUrl: cfg.base_url,
      token: decrypt(cfg.instance_token),
    })

    // Cache for display elsewhere; never used to gate sending.
    await admin
      .from('uazapi_config')
      .update({
        status: live.status,
        paired_phone: live.phone,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)

    return NextResponse.json({ configured: true, ...live })
  } catch (err) {
    // Auth failures must keep their own status — mapping them to 502
    // would tell the UI the gateway is down when the caller simply
    // isn't signed in.
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return toErrorResponse(err)
    }
    // Anything else here came from the UAZAPI call itself.
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
