// ============================================================
// GET    /api/extrator/{id}?status=&q=&page= — one extraction, its
//                              numbers and a page of its results
// PATCH  /api/extrator/{id}  { action: 'cancel' } — stop a job
// DELETE /api/extrator/{id} — the extraction and its results (the
//                              contacts already in the CRM stay)
//
// Members read; admins write (migration 073).
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { describeFilters } from '@/lib/extractor/filters'
import { getExtraction, getExtractionSummary, listResults, RESULT_PAGE } from '@/lib/extractor/store'
import type { ResultStatus } from '@/lib/extractor/types'
import { supabaseAdmin } from '@/lib/leads/admin-client'

type Params = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: 'Extração não encontrada.' }, { status: 404 })

const STATUSES = ['novo', 'contato', 'extraido', 'bloqueado', 'sem_telefone', 'importados', 'pendentes'] as const

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const extraction = await getExtractionSummary(ctx.supabase, ctx.accountId, id)
    if (!extraction) return notFound()
    const url = new URL(request.url)
    const wanted = url.searchParams.get('status')
    const status = (STATUSES as readonly string[]).includes(wanted ?? '')
      ? (wanted as ResultStatus | 'importados' | 'pendentes')
      : undefined
    // "Marcar todos": only the ids of what the filter brings, every page.
    if (url.searchParams.get('ids') === '1') {
      let request = ctx.supabase
        .from('lead_extraction_results')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('extraction_id', id)
        .is('imported_at', null)
        .not('phone', 'is', null)
      if (status && status !== 'importados' && status !== 'pendentes') request = request.eq('status', status)
      const { data, error } = await request.order('created_at', { ascending: true }).limit(5000)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ids: ((data ?? []) as { id: string }[]).map((r) => r.id) })
    }
    const { rows, total } = await listResults(ctx.supabase, ctx.accountId, id, {
      status,
      search: url.searchParams.get('q') ?? '',
      page: Number(url.searchParams.get('page')) || 0,
    })
    // How this CRM can prospect: by QR code (uazapi), only by calls on
    // the official API (cold lists are not messaged there), or not yet.
    const provider = await resolveWhatsAppProvider(supabaseAdmin(), ctx.accountId).catch(() => null)
    return NextResponse.json({
      whatsapp: provider,
      extraction: { ...extraction, description: describeFilters(extraction.source, extraction.filters) },
      results: rows,
      total,
      pageSize: RESULT_PAGE,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null
    if (body?.action !== 'cancel') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
    const row = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!row) return notFound()
    const { error } = await supabaseAdmin()
      .from('lead_extractions')
      .update({ status: 'cancelled', claimed_at: null, finished_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .in('status', ['queued', 'running'])
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const row = await getExtraction(ctx.supabase, ctx.accountId, id)
    if (!row) return notFound()
    // The month's usage reads `found` from this row: deleting it must
    // not give the leads back, so the row stays as a record when it
    // brought anything — only its results go.
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('lead_extraction_results')
      .delete()
      .eq('extraction_id', id)
      .eq('account_id', ctx.accountId)
    if (error) throw new Error(error.message)
    const { error: rowError } =
      row.found > 0
        ? await admin
            .from('lead_extractions')
            .update({ status: 'cancelled', claimed_at: null, error: 'Apagada.' })
            .eq('id', id)
            .eq('account_id', ctx.accountId)
        : await admin.from('lead_extractions').delete().eq('id', id).eq('account_id', ctx.accountId)
    if (rowError) throw new Error(rowError.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
