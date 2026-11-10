import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { resolvePublicOrigin } from '@/lib/http/base-url'
import {
  connectUazapiInstance,
  createUazapiInstance,
  setUazapiWebhook,
} from '@/lib/uazapi/api'
import { hostedUazapi, isHostedBaseUrl } from '@/lib/uazapi/hosted'

// Start (or restart) pairing for the account's UAZAPI instance.
//
// This is the one call that makes "connect my WhatsApp" a button rather
// than a credentials-copying chore:
//
//   1. Mint an instance on the server if we don't have one yet — needs
//      the admin token, which never leaves the server.
//   2. Point that instance's webhook at our inbound URL, so messages
//      start arriving without anyone pasting anything.
//   3. Kick off pairing. The QR itself is NOT in this response; the UI
//      polls /api/uazapi/status for it (that is where UAZAPI exposes it).
//
// Two ways to know the server (D1):
//   - hosted: the Harpium's own server, from UAZAPI_BASE_URL /
//     UAZAPI_ADMIN_TOKEN. A CRM with no server saved uses it, and the
//     client never sees an address or a token. Connecting turns the
//     channel on: on this path there is no separate "enable" step.
//   - manual: an address and tokens an admin saved in /canais/uazapi
//     (agency, or a CRM with its own server). Unchanged.
//
// Admins+ only: it spends server credit and rewires where this account's
// messages are delivered.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => ({}))
    // Optional: pair by numeric code instead of QR.
    const phone =
      typeof body?.phone === 'string' && body.phone.trim()
        ? body.phone.replace(/\D/g, '')
        : undefined

    const admin = supabaseAdmin()
    const hosted = hostedUazapi()
    const { data: saved } = await admin
      .from('uazapi_config')
      .select(
        'base_url, admin_token, instance_token, instance_name, webhook_token',
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    let cfg = saved

    // No server saved: use the Harpium's, creating the row on the way.
    if (!cfg?.base_url && hosted) {
      const row = {
        account_id: ctx.accountId,
        base_url: hosted.baseUrl,
        webhook_token: cfg?.webhook_token ?? randomBytes(24).toString('hex'),
        enabled: true,
        updated_at: new Date().toISOString(),
      }
      const { error: upErr } = await admin
        .from('uazapi_config')
        .upsert(row, { onConflict: 'account_id' })
      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      }
      cfg = {
        base_url: hosted.baseUrl,
        admin_token: cfg?.admin_token ?? null,
        instance_token: cfg?.instance_token ?? null,
        instance_name: cfg?.instance_name ?? null,
        webhook_token: row.webhook_token,
      }
    }

    if (!cfg?.base_url) {
      return NextResponse.json(
        { error: 'Informe a URL do servidor UAZAPI e salve antes de conectar.' },
        { status: 400 },
      )
    }
    if (!cfg.webhook_token) {
      return NextResponse.json(
        { error: 'Configuração incompleta. Recarregue a página.' },
        { status: 400 },
      )
    }
    const onHostedServer = isHostedBaseUrl(cfg.base_url, hosted)

    // A wrong origin would hand this account's messages to another host,
    // so refuse rather than guess. See resolvePublicOrigin.
    const origin = resolvePublicOrigin(request, 'POST /api/uazapi/connect')
    if (!origin) {
      return NextResponse.json(
        {
          error:
            'Não foi possível determinar a URL pública do sistema. Defina NEXT_PUBLIC_SITE_URL.',
        },
        { status: 500 },
      )
    }

    // 1. Instance — reuse the stored one, or mint a new one.
    let instanceToken: string
    if (cfg.instance_token) {
      instanceToken = decrypt(cfg.instance_token)
    } else {
      // The Harpium's server is minted with its token from the
      // environment; a manual server, with the one saved for it.
      const adminToken = cfg.admin_token
        ? decrypt(cfg.admin_token)
        : onHostedServer
          ? hosted!.adminToken
          : null
      if (!adminToken) {
        return NextResponse.json(
          {
            error:
              'Informe o token de administrador do servidor (para criar a instância) ou cole o token de uma instância existente.',
          },
          { status: 400 },
        )
      }
      const name = cfg.instance_name?.trim() || `harpium-${ctx.accountId.slice(0, 8)}`
      const created = await createUazapiInstance(cfg.base_url, adminToken, name)
      instanceToken = created.token
      const { error: saveErr } = await admin
        .from('uazapi_config')
        .update({
          instance_token: encrypt(instanceToken),
          instance_name: created.instanceName,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId)
      if (saveErr) {
        // The instance exists on the server but we failed to record its
        // token — say so plainly rather than silently minting another on
        // the next click.
        return NextResponse.json(
          { error: `Instância criada, mas falhou ao salvar o token: ${saveErr.message}` },
          { status: 500 },
        )
      }
    }

    const srv = { baseUrl: cfg.base_url, token: instanceToken }

    // 2. Webhook, then 3. pairing.
    await setUazapiWebhook(srv, `${origin}/api/uazapi/webhook/${cfg.webhook_token}`)
    await connectUazapiInstance(srv, phone)

    await admin
      .from('uazapi_config')
      .update({
        status: 'connecting',
        ...(onHostedServer ? { enabled: true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', ctx.accountId)

    return NextResponse.json({ ok: true, mode: phone ? 'paircode' : 'qr' })
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
