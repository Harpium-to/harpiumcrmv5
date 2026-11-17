import { leadPhone, phoneKind } from '../phone'
import type { ExtractedLead, MapsFilters } from '../types'
import type { SourceAdapter, SourcePage } from './types'

// ============================================================
// The Google Maps source, through a collection service (Outscraper).
//
// Decision 1 of docs/plano-extrator-leads.md: the places come from a
// third party that reads Google Maps, in an account that is NOT one of
// Harpium's Google accounts. This file is the only place that knows
// who that third party is — swapping it is rewriting this adapter.
//
//   OUTSCRAPER_API_KEY          the service's key
//   OUTSCRAPER_USD_PER_1000     what it charges per 1,000 places
//                               (default 3; only for the cost shown)
//
// The service works on a request that takes a while: the first slice
// of a job submits it, the next ones ask whether it is ready.
// ============================================================

const API = 'https://api.app.outscraper.com'

/** One search brings at most this many places from the service. */
export const MAPS_PER_QUERY_CEILING = 400

export function mapsConfigured(): boolean {
  return Boolean(process.env.OUTSCRAPER_API_KEY)
}

export function mapsUsdPer1000(): number {
  const n = Number(process.env.OUTSCRAPER_USD_PER_1000)
  return Number.isFinite(n) && n >= 0 ? n : 3
}

/** What the extraction of `places` places costs, estimated. */
export function mapsCostUsd(places: number): number {
  return Math.round((places / 1000) * mapsUsdPer1000() * 10000) / 10000
}

/**
 * The searches for these filters: one for the city, or one per
 * neighbourhood — the way past the ceiling of a single search.
 */
export function mapsQueries(filters: MapsFilters): string[] {
  const where = `${filters.cidade}, ${filters.uf}, Brasil`
  const districts = filters.bairros ?? []
  if (districts.length === 0) return [`${filters.termo}, ${where}`]
  return districts.map((district) => `${filters.termo}, ${district}, ${where}`)
}

/** How many places to ask of each search so the total reaches `want`. */
export function perQueryLimit(want: number, queries: number): number {
  return Math.min(MAPS_PER_QUERY_CEILING, Math.max(20, Math.ceil(want / Math.max(queries, 1))))
}

type Place = Record<string, unknown>

const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** A site that is really a social page is not "the company's site". */
function ownSite(url: string | null): string | null {
  if (!url) return null
  return /(?:instagram|facebook|linktr\.ee|wa\.me|whatsapp|google)\./i.test(url) ? null : url
}

function instagramOf(url: string | null): string | null {
  const m = /instagram\.com\/([A-Za-z0-9._]{2,30})/i.exec(url ?? '')
  return m && !/^(p|reel|explore|stories)$/i.test(m[1]) ? `@${m[1].replace(/\.+$/, '')}` : null
}

/** One place of the service as an extracted lead, or null. Pure. */
export function mapsLead(place: Place, filters: Pick<MapsFilters, 'uf' | 'cidade'>): ExtractedLead | null {
  const key = str(place.place_id) ?? str(place.google_id)
  const name = str(place.name)
  if (!key || !name) return null
  // A place Google marks as closed for good is not a lead.
  if (/closed_permanently/i.test(str(place.business_status) ?? '')) return null
  const site = str(place.site) ?? str(place.website)
  return {
    source: 'google_maps',
    externalKey: key,
    kind: 'empresa',
    name,
    phone: leadPhone(str(place.phone)),
    email: null,
    website: ownSite(site),
    instagram: instagramOf(site),
    address: str(place.full_address) ?? str(place.address),
    district: str(place.borough),
    city: str(place.city) ?? filters.cidade,
    uf: filters.uf,
    cep: str(place.postal_code),
    activity: str(place.category) ?? str(place.type),
    extras: {
      nota: num(place.rating),
      avaliacoes: num(place.reviews),
      maps: str(place.location_link),
    },
  }
}

/** Our own filters, applied to what the service brought. Pure. */
export function mapsKeep(lead: ExtractedLead, filters: MapsFilters): boolean {
  const rating = typeof lead.extras.nota === 'number' ? lead.extras.nota : null
  const reviews = typeof lead.extras.avaliacoes === 'number' ? lead.extras.avaliacoes : 0
  if (filters.nota_min !== undefined && (rating === null || rating < filters.nota_min)) return false
  if (filters.nota_max !== undefined && rating !== null && rating > filters.nota_max) return false
  if (filters.avaliacoes_min !== undefined && reviews < filters.avaliacoes_min) return false
  const hasSite = Boolean(lead.website)
  if (filters.site === 'com' && !hasSite) return false
  if (filters.site === 'sem' && hasSite) return false
  if (filters.com_telefone && !lead.phone) return false
  if (filters.so_celular && phoneKind(lead.phone) !== 'celular') return false
  return true
}

/** The places of a finished request: one list per search, flattened. */
export function flattenPlaces(data: unknown): Place[] {
  const out: Place[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') out.push(v as Place)
  }
  walk(data)
  return out
}

export interface MapsDeps {
  fetch: typeof fetch
}

async function call(deps: MapsDeps, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await deps.fetch(`${API}${path}`, {
    method,
    headers: {
      'X-API-KEY': process.env.OUTSCRAPER_API_KEY ?? '',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.status === 401 || res.status === 403) {
    throw new Error('O serviço do Google Maps recusou a chave. Confira OUTSCRAPER_API_KEY.')
  }
  if (res.status === 402) {
    throw new Error('O serviço do Google Maps está sem saldo. Fale com a Harpium.')
  }
  if (!res.ok || !json) throw new Error(`O serviço do Google Maps respondeu ${res.status}.`)
  if (json.error) throw new Error(`O serviço do Google Maps recusou: ${str(json.errorMessage) ?? 'erro'}`)
  return json
}

export function createMapsSource(deps: MapsDeps = { fetch }): SourceAdapter<MapsFilters> {
  return {
    available() {
      return mapsConfigured()
        ? { available: true }
        : {
            available: false,
            reason: 'O Google Maps ainda não foi ligado a este CRM. Fale com a Harpium.',
          }
    },

    async fetchPage(filters, cursor, want): Promise<SourcePage> {
      const requestId = typeof cursor.pedido === 'string' ? cursor.pedido : null
      if (!requestId) {
        const queries = mapsQueries(filters)
        const submitted = await call(deps, 'POST', '/google-maps-search', {
          query: queries,
          language: 'pt-BR',
          region: 'BR',
          organizationsPerQueryLimit: perQueryLimit(want, queries.length),
          dropDuplicates: true,
          async: true,
        })
        const id = str(submitted.id)
        if (!id) throw new Error('O serviço do Google Maps não devolveu o número do pedido.')
        return { leads: [], fetched: 0, cursor: { pedido: id }, costUsd: 0, waiting: true }
      }

      const result = await call(deps, 'GET', `/requests/${encodeURIComponent(requestId)}`)
      const status = str(result.status) ?? ''
      if (/^pending$/i.test(status)) {
        return { leads: [], fetched: 0, cursor, costUsd: 0, waiting: true }
      }
      if (!/^success$/i.test(status)) {
        throw new Error(`O serviço do Google Maps não concluiu a busca (${status || 'sem resposta'}).`)
      }
      const seen = new Set<string>()
      const leads: ExtractedLead[] = []
      const places = flattenPlaces(result.data)
      for (const place of places) {
        const lead = mapsLead(place, filters)
        if (!lead || seen.has(lead.externalKey)) continue
        seen.add(lead.externalKey)
        if (mapsKeep(lead, filters)) leads.push(lead)
      }
      // The service charges for what it brought, kept or not.
      return { leads, fetched: places.length, cursor: null, costUsd: mapsCostUsd(places.length), waiting: false }
    },
  }
}

export const mapsSource = createMapsSource()
