// ============================================================
// POST /api/extrator/preview  { source, filters, requested? }
//
// Before extracting: how many companies the filters bring (the CNPJ
// base counts; Google Maps cannot say beforehand) and what it would
// cost. Admins only — it queries the sources.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { FilterError, isExtractionSource, parseFilters } from '@/lib/extractor/filters'
import { sourceOf } from '@/lib/extractor/run'
import { mapsCostUsd, mapsQueries, perQueryLimit } from '@/lib/extractor/sources/maps'
import { MAX_PER_EXTRACTION, type MapsFilters } from '@/lib/extractor/types'

/** Counting stops here: beyond it the screen says "mais de". */
const COUNT_CEILING = 10000

export async function POST(request: Request) {
  try {
    await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!isExtractionSource(body?.source)) {
      return NextResponse.json({ error: 'Escolha a fonte.' }, { status: 400 })
    }
    const source = body.source
    let filters
    try {
      filters = parseFilters(source, body?.filters)
    } catch (err) {
      if (err instanceof FilterError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }
    const adapter = sourceOf(source)
    const availability = adapter.available()
    if (!availability.available) {
      return NextResponse.json({ error: availability.reason }, { status: 409 })
    }

    if (source === 'google_maps') {
      const wanted = Math.min(
        Math.max(1, Math.round(Number(body?.requested) || 100)),
        MAX_PER_EXTRACTION.google_maps,
      )
      const queries = mapsQueries(filters as MapsFilters)
      const upTo = perQueryLimit(wanted, queries.length) * queries.length
      return NextResponse.json({
        count: null,
        searches: queries.length,
        // The service charges for what it brings, before our filters.
        costUsd: mapsCostUsd(upTo),
        upTo,
      })
    }

    try {
      const count = adapter.count ? await adapter.count(filters, COUNT_CEILING) : null
      return NextResponse.json({
        count: count === null ? null : Math.min(count, COUNT_CEILING),
        more: count !== null && count > COUNT_CEILING,
        costUsd: 0,
      })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'A base de CNPJ não respondeu.' },
        { status: 502 },
      )
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
