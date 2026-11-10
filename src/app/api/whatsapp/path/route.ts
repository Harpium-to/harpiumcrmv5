import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkPathChoice } from '@/lib/channels/path-choice'
import {
  effectivePath,
  isWhatsAppPath,
  loadRouteFacts,
  pickProvider,
  WHATSAPP_RISK_TERMS_VERSION,
  type WhatsAppPath,
} from '@/lib/channels/whatsapp-route'
import { hostedUazapi, isHostedBaseUrl } from '@/lib/uazapi/hosted'

// ============================================================
// Settings › WhatsApp: which path this CRM is on, and choosing it (D1).
//
// GET  — any member: the path, what each side has connected, and
//        whether the caller may choose.
// POST — admins+: choose. The unofficial path needs the risk
//        acceptance (path-choice.ts) and is refused through the
//        agency's access. Written with the service role: a trigger
//        (061) keeps the client's own session from changing the
//        column directly, so this route's checks can't be skipped.
//
// Before 061 the column doesn't exist: GET says so (`migrationReady`)
// and POST answers 503, while everything else keeps working on the
// old implicit rule.
// ============================================================

type Admin = ReturnType<typeof supabaseAdmin>

/** The stored path, or `missing` when 061 isn't applied. */
async function readStoredPath(
  admin: Admin,
  accountId: string,
): Promise<{ path: WhatsAppPath | null; missing: boolean }> {
  const { data, error } = await admin
    .from('accounts')
    .select('whatsapp_path')
    .eq('id', accountId)
    .maybeSingle()
  if (error) return { path: null, missing: true }
  const raw = (data as { whatsapp_path?: unknown } | null)?.whatsapp_path
  return { path: isWhatsAppPath(raw) ? raw : null, missing: false }
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const admin = supabaseAdmin()
    const hosted = hostedUazapi()

    const [stored, facts, meta, uaz] = await Promise.all([
      readStoredPath(admin, ctx.accountId),
      loadRouteFacts(admin, ctx.accountId),
      admin
        .from('whatsapp_config')
        .select('phone_number_id, status')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      admin
        .from('uazapi_config')
        .select('base_url, instance_token, enabled, status, paired_phone')
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
    ])

    const metaRow = meta.data as { phone_number_id: string | null; status: string | null } | null
    const uazRow = uaz.data as
      | {
          base_url: string | null
          instance_token: string | null
          enabled: boolean
          status: string | null
          paired_phone: string | null
        }
      | null
    const metaConfigured = Boolean(metaRow?.phone_number_id)

    return NextResponse.json({
      path: stored.path,
      effectivePath: effectivePath({ ...facts, metaConfigured }),
      provider: pickProvider(facts),
      migrationReady: !stored.missing,
      canChoose: hasMinRole(ctx.role, 'admin') && ctx.status !== 'suspended',
      viaAgency: ctx.viaAgency,
      riskTermsVersion: WHATSAPP_RISK_TERMS_VERSION,
      hostedUnofficial: hosted !== null,
      oficial: {
        connected: metaConfigured,
      },
      naoOficial: {
        // An instance exists (it may be paired or not).
        configured: Boolean(uazRow?.base_url && uazRow.instance_token),
        enabled: Boolean(uazRow?.enabled),
        // A server of its own (set up by the agency): shown, not edited, here.
        manualServer: Boolean(uazRow?.base_url) && !isHostedBaseUrl(uazRow?.base_url, hosted),
        status: uazRow?.status ?? null,
        phone: uazRow?.paired_phone ?? null,
        evolution: facts.evolutionReady,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => ({}))

    const check = checkPathChoice({
      path: body?.path,
      acceptRisk: body?.acceptRisk,
      termsVersion: body?.termsVersion,
      viaAgency: ctx.viaAgency,
    })
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status })
    }

    const admin = supabaseAdmin()
    const current = await readStoredPath(admin, ctx.accountId)
    if (current.missing) {
      return NextResponse.json(
        { error: 'Falta aplicar a migration 061 no banco para escolher o caminho do WhatsApp.' },
        { status: 503 },
      )
    }
    if (current.path === check.path) {
      return NextResponse.json({ ok: true, path: check.path, changed: false })
    }

    const nowIso = new Date().toISOString()
    const { error: upErr } = await admin
      .from('accounts')
      .update({ whatsapp_path: check.path, whatsapp_path_changed_at: nowIso })
      .eq('id', ctx.accountId)
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    const { error: logErr } = await admin.from('whatsapp_path_log').insert({
      account_id: ctx.accountId,
      path: check.path,
      previous_path: current.path,
      chosen_by: ctx.userId,
      via_agency: ctx.viaAgency,
      risk_terms_version: check.riskTermsVersion,
    })
    if (logErr) {
      // The choice holds; the history line is what failed. Loud, but
      // not worth undoing a change the person just confirmed.
      console.error('[whatsapp/path] log insert failed:', logErr.message)
    }

    // Leaving the unofficial path: the QR-code instance stops sending
    // (the provider rule already ignores it on 'oficial'; this keeps the
    // saved state honest). It stays paired until someone disconnects it,
    // so coming back doesn't need a new QR.
    // Coming back to it: an instance that's still there takes over again.
    const { data: uaz } = await admin
      .from('uazapi_config')
      .select('base_url, instance_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (uaz) {
      const ready = Boolean(
        (uaz as { base_url: string | null }).base_url &&
          (uaz as { instance_token: string | null }).instance_token,
      )
      await admin
        .from('uazapi_config')
        .update({
          enabled: check.path === 'nao_oficial' && ready,
          updated_at: nowIso,
        })
        .eq('account_id', ctx.accountId)
    }

    return NextResponse.json({ ok: true, path: check.path, changed: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
