import { formatCnpj } from './sources/cnpj'
import type { ResultRow } from './store'
import { SOURCE_ORIGIN, type ExtractionSource } from './types'

// ============================================================
// An extracted row as a lead, in the Harpium Lead v1 format the CRM's
// own receiver reads (docs/recebimento-universal-de-leads.md) — the
// same door the Quiz uses, so tags, custom fields, the note and the
// duplicate rule by phone are the CRM's, not a second copy.
//
// Pure — no I/O.
// ============================================================

/** Every extracted contact carries this tag. */
export const EXTRACTOR_TAG = 'extrator'
/** Marks a MEI or sole trader: the name and number are a person's. */
export const PERSONAL_TAG = 'dado-pessoal'
/** A cold lead who wrote back. */
export const REPLIED_TAG = 'respondeu'

/** The list's tag: its name, as the person typed it. */
export function listTag(listName: string): string {
  return listName.replace(/\s+/g, ' ').trim().slice(0, 60)
}

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const brDate = (iso: string) => iso.split('-').reverse().join('/')

/** The extra data as custom fields: name → value, only what is filled. */
export function leadFields(row: Pick<ResultRow, 'source' | 'external_key' | 'activity' | 'website' | 'address' | 'district' | 'cep' | 'uf' | 'extras'>): Record<string, string> {
  const x = row.extras ?? {}
  const out: Record<string, string> = {}
  const put = (name: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    out[name] = String(value)
  }
  if (row.source === 'cnpj') put('CNPJ', typeof x.cnpj === 'string' ? x.cnpj : formatCnpj(row.external_key))
  put('Razão social', x.razao_social)
  put('Atividade', row.activity)
  put('Porte', x.porte)
  if (typeof x.abertura === 'string') put('Data de abertura', brDate(x.abertura))
  if (typeof x.capital === 'number' && x.capital > 0) put('Capital social', money(x.capital))
  put('Responsável', x.responsavel)
  if (typeof x.nota === 'number') put('Nota no Google', x.nota.toLocaleString('pt-BR'))
  if (typeof x.avaliacoes === 'number') put('Avaliações no Google', x.avaliacoes)
  put('Site', row.website)
  put('Endereço', [row.address, row.district].filter(Boolean).join(' - '))
  put('CEP', row.cep)
  return out
}

export interface LeadContext {
  extractionId: string
  extractionName: string
  listName: string
  /** The filters in one line, for the note. */
  search: string
  extractedAt: string
}

/** The Harpium Lead v1 payload of one extracted row. */
export function buildLeadPayload(row: ResultRow, ctx: LeadContext): Record<string, unknown> {
  const origin = SOURCE_ORIGIN[row.source as ExtractionSource]
  const tags = [EXTRACTOR_TAG, listTag(ctx.listName)]
  if (row.kind === 'pessoa') tags.push(PERSONAL_TAG)
  const when = new Date(ctx.extractedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return {
    versao: '1',
    origem: origin,
    formulario: ctx.extractionName,
    // The same row sent twice is one delivery (rule 8).
    id_externo: `${ctx.extractionId}:${row.external_key}`.slice(0, 200),
    contato: {
      nome: row.name,
      telefone: row.phone ?? '',
      email: row.email ?? '',
      empresa: row.name,
      cidade: row.city ?? '',
      uf: row.uf ?? '',
      instagram: row.instagram ?? '',
    },
    etiquetas: tags.filter(Boolean),
    campos: leadFields(row),
    nota: [
      `${origin} · lista "${ctx.listName}"`,
      `Busca: ${ctx.search || ctx.extractionName}`,
      `Extraído em ${when}. Contato frio: ainda não falou com a empresa.`,
      row.kind === 'pessoa' ? 'Contém dado pessoal (MEI ou autônomo): a oferta precisa ser sobre a atividade profissional.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}
