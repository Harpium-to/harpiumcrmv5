// ============================================================
// GET  /api/extrator — the CRM's extractions with their numbers, the
//                      month's usage against the ceiling, which
//                      sources are connected and the terms' state
// POST /api/extrator — start one  { name, source, filters, requested }
//
// Members read; admins start (migration 073).
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { FilterError, isExtractionSource, parseFilters, parseRequested } from '@/lib/extractor/filters'
import { sourceOf } from '@/lib/extractor/run'
import { cnpjBaseMonth } from '@/lib/extractor/sources/cnpj'
import { mapsUsdPer1000 } from '@/lib/extractor/sources/maps'
import {
  createExtraction,
  isMissingTable,
  listExtractions,
  loadSettings,
  monthlyUsage,
} from '@/lib/extractor/store'
import {
  EXTRACTION_SOURCES,
  MAX_PER_EXTRACTION,
  MIGRATION_PENDING,
  UNUSED_RESULTS_DAYS,
} from '@/lib/extractor/types'
import { supabaseAdmin } from '@/lib/leads/admin-client'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const sources = Object.fromEntries(
      EXTRACTION_SOURCES.map((source) => [source, sourceOf(source).available()]),
    )
    const extractions = await listExtractions(ctx.supabase, ctx.accountId)
    if (extractions === null) {
      return NextResponse.json({ available: false, error: MIGRATION_PENDING, extractions: [], sources })
    }
    const [settings, used, baseMonth] = await Promise.all([
      loadSettings(ctx.supabase, ctx.accountId),
      monthlyUsage(ctx.supabase, ctx.accountId),
      cnpjBaseMonth(),
    ])
    return NextResponse.json({
      available: true,
      extractions,
      sources,
      usage: { used, limit: settings.monthlyLimit },
      termsAcceptedAt: settings.termsAcceptedAt,
      maxPerExtraction: MAX_PER_EXTRACTION,
      mapsUsdPer1000: mapsUsdPer1000(),
      cnpjBaseMonth: baseMonth,
      keepDays: UNUSED_RESULTS_DAYS,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!isExtractionSource(body?.source)) {
      return NextResponse.json({ error: 'Escolha a fonte.' }, { status: 400 })
    }
    const source = body.source
    const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    if (!name) return NextResponse.json({ error: 'Dê um nome à extração.' }, { status: 400 })

    let filters
    let requested
    try {
      filters = parseFilters(source, body?.filters)
      requested = parseRequested(source, body?.requested)
    } catch (err) {
      if (err instanceof FilterError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }

    const availability = sourceOf(source).available()
    if (!availability.available) {
      return NextResponse.json({ error: availability.reason }, { status: 409 })
    }

    const settings = await loadSettings(ctx.supabase, ctx.accountId)
    if (!settings.termsAcceptedAt) {
      return NextResponse.json(
        { error: 'Leia e aceite o termo de uso do Extrator antes da primeira extração.', code: 'terms' },
        { status: 409 },
      )
    }
    let used: number
    try {
      used = await monthlyUsage(ctx.supabase, ctx.accountId)
    } catch (err) {
      if (isMissingTable(err as { code?: string; message?: string })) {
        return NextResponse.json({ error: MIGRATION_PENDING }, { status: 503 })
      }
      throw err
    }
    const room = settings.monthlyLimit - used
    if (room <= 0) {
      return NextResponse.json(
        {
          error: `Este CRM já usou os ${settings.monthlyLimit.toLocaleString('pt-BR')} leads do mês. O limite volta no dia 1º, ou fale com a Harpium.`,
          code: 'limit',
        },
        { status: 409 },
      )
    }

    try {
      const row = await createExtraction(supabaseAdmin(), {
        accountId: ctx.accountId,
        userId: ctx.userId,
        name,
        source,
        filters,
        // What is left of the month is the most this one may bring.
        requested: Math.min(requested, room),
      })
      return NextResponse.json({ id: row.id, requested: row.requested }, { status: 201 })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/does not exist|could not find the table/i.test(message)) {
        return NextResponse.json({ error: MIGRATION_PENDING }, { status: 503 })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
