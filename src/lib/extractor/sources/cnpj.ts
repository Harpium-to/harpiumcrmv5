import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { bestPhone } from '../phone'
import { PORTE_LABEL, type CnpjFilters, type ExtractedLead } from '../types'
import type { SourceAdapter, SourcePage } from './types'

// ============================================================
// The CNPJ source: our own copy of the Receita Federal's public
// company registry, in a SEPARATE database (supabase/cnpj-base/schema.sql,
// loaded monthly by scripts/cnpj-base/importar.mjs).
//
// The CRM reads it with that project's service key:
//   CNPJ_BASE_URL   https://xxxx.supabase.co
//   CNPJ_BASE_KEY   the service-role key of that project
//
// Without them the source says it is not connected and the rest of the
// extractor keeps working.
// ============================================================

/** Rows read from the base in one slice of a job. */
export const CNPJ_PAGE = 200

let client: SupabaseClient | null = null

export function cnpjBaseConfigured(): boolean {
  return Boolean(process.env.CNPJ_BASE_URL && process.env.CNPJ_BASE_KEY)
}

function base(): SupabaseClient {
  if (!cnpjBaseConfigured()) {
    throw new Error('A base de CNPJ ainda não foi conectada (CNPJ_BASE_URL e CNPJ_BASE_KEY).')
  }
  client ??= createClient(process.env.CNPJ_BASE_URL!, process.env.CNPJ_BASE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

export interface CnpjRow {
  cnpj: string
  matriz: boolean
  nome_fantasia: string | null
  razao_social: string | null
  abertura: string | null
  cnae: string | null
  cnae_descricao: string | null
  endereco: string | null
  bairro: string | null
  cep: string | null
  uf: string | null
  municipio: number | null
  municipio_nome: string | null
  telefone1: string | null
  telefone2: string | null
  email: string | null
  porte: string | null
  capital: number | string | null
  mei: boolean
  natureza: string | null
  responsavel: string | null
}

/** "GOIANIA" → "Goiania": the Receita writes everything in capitals. */
export function titleCase(value: string | null | undefined): string | null {
  const s = (value ?? '').trim()
  if (!s) return null
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o'])
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i > 0 && small.has(word)) return word
      // "S/A", "LTDA", "ME", "EPP", "EIRELI" read better in capitals.
      if (/^(s\/a|s\.a\.?|ltda\.?|me|epp|eireli|mei|cia\.?)$/.test(word)) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function formatCnpj(cnpj: string): string {
  return cnpj.length === 14
    ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    : cnpj
}

/** 2135: empresário individual — like a MEI, the name is a person's. */
const SOLE_TRADER = '2135'

/** One row of the base as an extracted lead. Pure. */
export function cnpjLead(row: CnpjRow): ExtractedLead {
  const personal = row.mei || row.natureza === SOLE_TRADER
  const name = titleCase(row.nome_fantasia) ?? titleCase(row.razao_social) ?? formatCnpj(row.cnpj)
  const capital = row.capital === null || row.capital === '' ? null : Number(row.capital)
  return {
    source: 'cnpj',
    externalKey: row.cnpj,
    kind: personal ? 'pessoa' : 'empresa',
    name,
    phone: bestPhone(row.telefone1, row.telefone2),
    email: row.email,
    website: null,
    instagram: null,
    address: titleCase(row.endereco),
    district: titleCase(row.bairro),
    city: titleCase(row.municipio_nome),
    uf: row.uf,
    cep: row.cep,
    activity: row.cnae_descricao,
    extras: {
      cnpj: formatCnpj(row.cnpj),
      razao_social: titleCase(row.razao_social),
      porte: row.mei ? 'MEI' : row.porte ? (PORTE_LABEL[row.porte] ?? null) : null,
      abertura: row.abertura,
      capital: Number.isFinite(capital) ? capital : null,
      unidade: row.matriz ? 'Matriz' : 'Filial',
      // For a MEI or a sole trader the company's name already is the
      // person's; a separate "responsável" would only repeat it.
      responsavel: personal ? null : titleCase(row.responsavel),
    },
  }
}

/** The JSON cnpj_filtrar() reads: the labels stay on our side. */
function forBase(filters: CnpjFilters): Record<string, unknown> {
  const { rotulos: _labels, ...rest } = filters
  void _labels
  return rest
}

export const cnpjSource: SourceAdapter<CnpjFilters> = {
  available() {
    return cnpjBaseConfigured()
      ? { available: true }
      : {
          available: false,
          reason: 'A base de CNPJ ainda não foi conectada a este CRM. Fale com a Harpium.',
        }
  },

  async fetchPage(filters, cursor, want): Promise<SourcePage> {
    const after = typeof cursor.apos === 'string' ? cursor.apos : ''
    const limit = Math.min(Math.max(want, 1), CNPJ_PAGE)
    const { data, error } = await base().rpc('cnpj_buscar', {
      p_filtros: forBase(filters),
      p_apos: after,
      p_limite: limit,
    })
    if (error) throw new Error(`A base de CNPJ não respondeu: ${error.message}`)
    const rows = (data ?? []) as CnpjRow[]
    return {
      leads: rows.map(cnpjLead),
      fetched: rows.length,
      // Fewer than asked: the filter is exhausted.
      cursor: rows.length < limit ? null : { apos: rows[rows.length - 1].cnpj },
      costUsd: 0,
      waiting: false,
    }
  },

  async count(filters, ceiling) {
    const { data, error } = await base().rpc('cnpj_contar', {
      p_filtros: forBase(filters),
      p_teto: ceiling + 1,
    })
    if (error) throw new Error(`A base de CNPJ não respondeu: ${error.message}`)
    return Number(data ?? 0)
  },
}

export interface CnaeOption {
  codigo: string
  descricao: string
}

export interface CityOption {
  codigo: number
  nome: string
  uf: string | null
}

const likeSafe = (q: string) => q.replace(/[%_\\,()]/g, ' ').trim()

/** Activities whose description or code matches what was typed. */
export async function searchCnaes(query: string): Promise<CnaeOption[]> {
  const q = likeSafe(query)
  if (q.length < 2) return []
  const digits = q.replace(/\D/g, '')
  let request = base().from('cnpj_cnaes').select('codigo, descricao').order('descricao').limit(30)
  request =
    digits.length >= 2 && digits.length === q.replace(/[\s./-]/g, '').length
      ? request.like('codigo', `${digits}%`)
      : request.ilike('descricao', `%${q.split(/\s+/).join('%')}%`)
  const { data, error } = await request
  if (error) throw new Error(`A base de CNPJ não respondeu: ${error.message}`)
  return (data ?? []) as CnaeOption[]
}

/** Cities of a state whose name matches what was typed. */
export async function searchCities(uf: string, query: string): Promise<CityOption[]> {
  const q = likeSafe(query)
  let request = base().from('cnpj_municipios').select('codigo, nome, uf').order('nome').limit(30)
  if (uf) request = request.eq('uf', uf.toUpperCase())
  if (q) request = request.ilike('nome', `${q.split(/\s+/).join('%')}%`)
  const { data, error } = await request
  if (error) throw new Error(`A base de CNPJ não respondeu: ${error.message}`)
  return ((data ?? []) as CityOption[]).map((c) => ({ ...c, nome: titleCase(c.nome) ?? c.nome }))
}

/** The month of the Receita's data in use ("2026-11"), or null. */
export async function cnpjBaseMonth(): Promise<string | null> {
  if (!cnpjBaseConfigured()) return null
  try {
    const { data } = await base().from('cnpj_meta').select('valor').eq('chave', 'lote').maybeSingle()
    return (data as { valor?: string } | null)?.valor ?? null
  } catch {
    return null
  }
}
