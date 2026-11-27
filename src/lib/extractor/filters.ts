import {
  MAX_PER_EXTRACTION,
  UFS,
  type CnpjFilters,
  type ExtractionFilters,
  type ExtractionSource,
  type MapsFilters,
} from './types'

// ============================================================
// What the "Nova extração" screen sent, checked and cleaned. Pure.
//
// Nothing here trusts the browser: lists are capped, text is trimmed,
// and only known keys go on to the source.
// ============================================================

export class FilterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FilterError'
  }
}

type Dict = Record<string, unknown>

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

function list<T>(v: unknown, max: number, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  const seen = new Set<string>()
  for (const item of v) {
    const value = map(item)
    if (value === null) continue
    const key = String(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

function number(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(Math.max(n, min), max)
}

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? undefined : v
}

const isUf = (v: unknown): v is string =>
  typeof v === 'string' && (UFS as readonly string[]).includes(v.toUpperCase())

export function parseCnpjFilters(body: unknown): CnpjFilters {
  const b = (body && typeof body === 'object' ? body : {}) as Dict
  const cnaes = list(b.cnaes, 30, (v) => {
    const d = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : ''
    return d.length === 7 ? d : null
  })
  const ufs = list(b.ufs, 27, (v) => (isUf(v) ? v.toUpperCase() : null))
  const municipios = list(b.municipios, 50, (v) => {
    const n = Number(v)
    return Number.isInteger(n) && n > 0 && n < 100000 ? n : null
  })
  if (cnaes.length === 0 && municipios.length === 0) {
    throw new FilterError('Escolha pelo menos uma atividade ou uma cidade.')
  }

  const tipo = b.tipo === 'mei' || b.tipo === 'empresas' ? b.tipo : 'todos'
  const out: CnpjFilters = { tipo }
  if (cnaes.length) out.cnaes = cnaes
  if (ufs.length) out.ufs = ufs
  if (municipios.length) out.municipios = municipios

  const bairro = text(b.bairro, 60)
  // % and _ are wildcards in the base's ILIKE.
  if (bairro) out.bairro = bairro.replace(/[%_\\]/g, '')
  const cep = text(b.cep, 12).replace(/\D/g, '')
  if (cep.length >= 2) out.cep = cep.slice(0, 8)

  const portes = list(b.portes, 4, (v) => (v === '01' || v === '03' || v === '05' || v === '00' ? v : null))
  if (portes.length) out.portes = portes

  const de = isoDate(b.abertura_de)
  const ate = isoDate(b.abertura_ate)
  if (de && ate && de > ate) throw new FilterError('A data inicial de abertura é depois da final.')
  if (de) out.abertura_de = de
  if (ate) out.abertura_ate = ate

  const min = number(b.capital_min, 0, 1e12)
  const max = number(b.capital_max, 0, 1e12)
  if (min !== undefined && max !== undefined && min > max) {
    throw new FilterError('O capital mínimo é maior que o máximo.')
  }
  if (min !== undefined && min > 0) out.capital_min = min
  if (max !== undefined) out.capital_max = max

  if (b.unidade === 'matriz' || b.unidade === 'filial') out.unidade = b.unidade
  if (b.com_telefone === true) out.com_telefone = true
  if (b.so_celular === true) out.so_celular = true
  if (b.com_email === true) out.com_email = true

  const rotulos = (b.rotulos && typeof b.rotulos === 'object' ? b.rotulos : {}) as Dict
  const labelList = (v: unknown, max: number) => list(v, max, (x) => text(x, 120) || null)
  const cnaeLabels = labelList(rotulos.cnaes, 30)
  const cityLabels = labelList(rotulos.municipios, 50)
  if (cnaeLabels.length || cityLabels.length) {
    out.rotulos = {
      ...(cnaeLabels.length ? { cnaes: cnaeLabels } : {}),
      ...(cityLabels.length ? { municipios: cityLabels } : {}),
    }
  }
  return out
}

export function parseMapsFilters(body: unknown): MapsFilters {
  const b = (body && typeof body === 'object' ? body : {}) as Dict
  const termo = text(b.termo, 80)
  const cidade = text(b.cidade, 80)
  if (termo.length < 2) throw new FilterError('Diga o que procurar (por exemplo, "dentista").')
  if (cidade.length < 2) throw new FilterError('Diga a cidade.')
  if (!isUf(b.uf)) throw new FilterError('Escolha o estado.')

  const out: MapsFilters = { termo, cidade, uf: b.uf.toUpperCase() }
  const bairros = list(b.bairros, 20, (v) => text(v, 60) || null)
  if (bairros.length) out.bairros = bairros

  const min = number(b.nota_min, 0, 5)
  const max = number(b.nota_max, 0, 5)
  if (min !== undefined && max !== undefined && min > max) {
    throw new FilterError('A nota mínima é maior que a máxima.')
  }
  if (min !== undefined && min > 0) out.nota_min = min
  if (max !== undefined && max < 5) out.nota_max = max
  const reviews = number(b.avaliacoes_min, 0, 1e6)
  if (reviews !== undefined && reviews > 0) out.avaliacoes_min = Math.round(reviews)
  if (b.site === 'com' || b.site === 'sem') out.site = b.site
  if (b.com_telefone === true) out.com_telefone = true
  if (b.so_celular === true) out.so_celular = true
  return out
}

export function parseFilters(source: ExtractionSource, body: unknown): ExtractionFilters {
  return source === 'cnpj' ? parseCnpjFilters(body) : parseMapsFilters(body)
}

/** How many results the person asked for, within the source's ceiling. */
export function parseRequested(source: ExtractionSource, value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 1) throw new FilterError('Diga quantos leads extrair.')
  return Math.min(n, MAX_PER_EXTRACTION[source])
}

export function isExtractionSource(v: unknown): v is ExtractionSource {
  return v === 'cnpj' || v === 'google_maps'
}

/** The filters in one line, for the list of extractions. */
export function describeFilters(source: ExtractionSource, filters: ExtractionFilters): string {
  if (source === 'google_maps') {
    const f = filters as MapsFilters
    const where = `${f.cidade}/${f.uf}`
    const parts = [`${f.termo} em ${where}`]
    if (f.bairros?.length) parts.push(`${f.bairros.length} ${f.bairros.length === 1 ? 'bairro' : 'bairros'}`)
    if (f.site === 'sem') parts.push('sem site')
    if (f.site === 'com') parts.push('com site')
    if (f.nota_min) parts.push(`nota a partir de ${f.nota_min}`)
    if (f.so_celular) parts.push('só celular')
    return parts.join(' · ')
  }
  const f = filters as CnpjFilters
  const parts: string[] = []
  const activities = f.rotulos?.cnaes ?? []
  if (activities.length) {
    parts.push(activities.length > 2 ? `${activities[0]} e mais ${activities.length - 1}` : activities.join(', '))
  } else if (f.cnaes?.length) {
    parts.push(`${f.cnaes.length} ${f.cnaes.length === 1 ? 'atividade' : 'atividades'}`)
  }
  const cities = f.rotulos?.municipios ?? []
  if (cities.length) {
    parts.push(cities.length > 2 ? `${cities[0]} e mais ${cities.length - 1}` : cities.join(', '))
  } else if (f.ufs?.length) {
    parts.push(f.ufs.join(', '))
  }
  if (f.bairro) parts.push(`bairro ${f.bairro}`)
  if (f.tipo === 'mei') parts.push('MEI e autônomos')
  if (f.tipo === 'empresas') parts.push('sem MEI')
  if (f.abertura_de) parts.push(`abertas desde ${f.abertura_de.split('-').reverse().join('/')}`)
  if (f.so_celular) parts.push('só celular')
  return parts.join(' · ')
}
