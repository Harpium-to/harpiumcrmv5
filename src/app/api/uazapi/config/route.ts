import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'

// Per-account UAZAPI channel config. Any member reads; admins+ save.
// Both tokens are stored encrypted and never returned — the UI only
// learns whether each one is set.
export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    let { data } = await ctx.supabase
      .from('uazapi_config')
      .select(
        'base_url, instance_name, status, paired_phone, enabled, webhook_token, admin_token, instance_token',
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    // Lazily mint the webhook token so the inbound URL always exists.
    if (!data) {
      const token = randomBytes(24).toString('hex')
      const { error } = await supabaseAdmin()
        .from('uazapi_config')
        .upsert(
          { account_id: ctx.accountId, webhook_token: token, enabled: false },
          { onConflict: 'account_id' },
        )
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      data = {
        base_url: null,
        instance_name: null,
        status: 'disconnected',
        paired_phone: null,
        enabled: false,
        webhook_token: token,
        admin_token: null,
        instance_token: null,
      }
    }

    return NextResponse.json({
      baseUrl: data.base_url ?? '',
      instanceName: data.instance_name ?? '',
      status: data.status ?? 'disconnected',
      pairedPhone: data.paired_phone ?? null,
      enabled: data.enabled ?? false,
      webhookToken: data.webhook_token,
      hasAdminToken: Boolean(data.admin_token),
      hasInstanceToken: Boolean(data.instance_token),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => ({}))

    const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
    const instanceName =
      typeof body?.instanceName === 'string' ? body.instanceName.trim() : ''
    const enabled = Boolean(body?.enabled)
    const pick = (v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : null
    const newAdminToken = pick(body?.adminToken)
    const newInstanceToken = pick(body?.instanceToken)

    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('uazapi_config')
      .select('webhook_token, admin_token, instance_token, base_url')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const webhookToken =
      existing?.webhook_token ?? randomBytes(24).toString('hex')

    // Keep stored tokens when the form didn't send new ones.
    const adminToken = newAdminToken
      ? encrypt(newAdminToken)
      : (existing?.admin_token ?? null)

    // Pointing at a different server invalidates the instance token that
    // was minted on the old one — drop it rather than send it somewhere
    // it means nothing.
    const serverChanged =
      Boolean(existing?.base_url) && baseUrl !== existing?.base_url
    const instanceToken = newInstanceToken
      ? encrypt(newInstanceToken)
      : serverChanged
        ? null
        : (existing?.instance_token ?? null)

    const { error } = await admin.from('uazapi_config').upsert(
      {
        account_id: ctx.accountId,
        base_url: baseUrl || null,
        admin_token: adminToken,
        instance_token: instanceToken,
        instance_name: instanceName || null,
        webhook_token: webhookToken,
        enabled,
        ...(serverChanged && !newInstanceToken
          ? { status: 'disconnected', paired_phone: null }
          : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, webhookToken })
  } catch (err) {
    return toErrorResponse(err)
  }
}
