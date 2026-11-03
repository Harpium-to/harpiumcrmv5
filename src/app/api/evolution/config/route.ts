import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'

// Per-account Evolution channel config. Any member reads; admins+ save.
// The api key is stored encrypted and never returned (only `hasApiKey`).
export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    let { data } = await ctx.supabase
      .from('evolution_config')
      .select('base_url, instance, enabled, webhook_token, api_key')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    // Lazily mint the webhook token so the URL is always available.
    if (!data) {
      const token = randomBytes(24).toString('hex')
      const { error } = await supabaseAdmin()
        .from('evolution_config')
        .upsert(
          { account_id: ctx.accountId, webhook_token: token, enabled: false },
          { onConflict: 'account_id' },
        )
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      data = {
        base_url: null,
        instance: null,
        enabled: false,
        webhook_token: token,
        api_key: null,
      }
    }

    return NextResponse.json({
      baseUrl: data.base_url ?? '',
      instance: data.instance ?? '',
      enabled: data.enabled ?? false,
      webhookToken: data.webhook_token,
      hasApiKey: Boolean(data.api_key),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => ({}))

    const baseUrl =
      typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
    const instance =
      typeof body?.instance === 'string' ? body.instance.trim() : ''
    const enabled = Boolean(body?.enabled)
    const newApiKey =
      typeof body?.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : null

    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('evolution_config')
      .select('webhook_token, api_key')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const webhookToken = existing?.webhook_token ?? randomBytes(24).toString('hex')
    // Keep the stored key if the form didn't send a new one.
    const apiKey = newApiKey ? encrypt(newApiKey) : (existing?.api_key ?? null)

    const { error } = await admin.from('evolution_config').upsert(
      {
        account_id: ctx.accountId,
        base_url: baseUrl || null,
        api_key: apiKey,
        instance: instance || null,
        webhook_token: webhookToken,
        enabled,
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
