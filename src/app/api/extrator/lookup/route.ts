// ============================================================
// GET /api/extrator/lookup?tipo=cnae&q=dent
// GET /api/extrator/lookup?tipo=cidade&uf=GO&q=goi
//
// The pickers of the CNPJ filters: activities (CNAE) by word or code,
// and the cities of a state. Read from the CNPJ base.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { cnpjBaseConfigured, searchCities, searchCnaes } from '@/lib/extractor/sources/cnpj'
import { UFS } from '@/lib/extractor/types'

export async function GET(request: Request) {
  try {
    await getCurrentAccount()
    if (!cnpjBaseConfigured()) {
      return NextResponse.json({ error: 'A base de CNPJ ainda não foi conectada.', items: [] }, { status: 409 })
    }
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, 80)
    try {
      if (url.searchParams.get('tipo') === 'cidade') {
        const uf = (url.searchParams.get('uf') ?? '').toUpperCase()
        if (!(UFS as readonly string[]).includes(uf)) return NextResponse.json({ items: [] })
        return NextResponse.json({ items: await searchCities(uf, q) })
      }
      return NextResponse.json({ items: await searchCnaes(q) })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'A base de CNPJ não respondeu.', items: [] },
        { status: 502 },
      )
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
