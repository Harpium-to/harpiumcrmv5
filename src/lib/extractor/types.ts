// ============================================================
// Ferramentas › Extrator de leads (migration 073,
// docs/plano-extrator-leads.md). The shapes every part shares.
// ============================================================

export type ExtractionSource = 'cnpj' | 'google_maps'

export const EXTRACTION_SOURCES: ExtractionSource[] = ['cnpj', 'google_maps']

export const SOURCE_LABEL: Record<ExtractionSource, string> = {
  cnpj: 'CNPJ (Receita Federal)',
  google_maps: 'Google Maps',
}

/** The origin an extracted lead carries into the CRM. */
export const SOURCE_ORIGIN: Record<ExtractionSource, string> = {
  cnpj: 'Extrator · CNPJ',
  google_maps: 'Extrator · Google Maps',
}

export type ExtractionStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/** What an extracted row is against the CRM, when it was extracted. */
export type ResultStatus = 'novo' | 'contato' | 'extraido' | 'bloqueado' | 'sem_telefone'

export const RESULT_STATUS_LABEL: Record<ResultStatus, string> = {
  novo: 'Novo',
  contato: 'Já é contato',
  extraido: 'Já extraído antes',
  bloqueado: 'Pediu para não receber',
  sem_telefone: 'Sem telefone',
}

export type LeadKind = 'empresa' | 'pessoa'

export type PhoneKind = 'celular' | 'fixo'

export type ExtraValue = string | number | boolean | null

/** One company as a source hands it over, already cleaned. */
export interface ExtractedLead {
  source: ExtractionSource
  /** The CNPJ, or Google's place id. */
  externalKey: string
  /** 'pessoa': a MEI or sole trader — carries personal data. */
  kind: LeadKind
  name: string
  /** "+5562999990000", or null. */
  phone: string | null
  email: string | null
  website: string | null
  instagram: string | null
  address: string | null
  district: string | null
  city: string | null
  uf: string | null
  cep: string | null
  activity: string | null
  extras: Record<string, ExtraValue>
}

/** Filters of the CNPJ source — the JSON cnpj_filtrar() reads. */
export interface CnpjFilters {
  cnaes?: string[]
  ufs?: string[]
  municipios?: number[]
  bairro?: string
  cep?: string
  tipo: 'empresas' | 'mei' | 'todos'
  portes?: string[]
  abertura_de?: string
  abertura_ate?: string
  capital_min?: number
  capital_max?: number
  unidade?: 'matriz' | 'filial'
  com_telefone?: boolean
  so_celular?: boolean
  com_email?: boolean
  /** How the choices read on screen ("Odontologia", "Goiânia/GO"). */
  rotulos?: { cnaes?: string[]; municipios?: string[] }
}

/** Filters of the Google Maps source. */
export interface MapsFilters {
  /** What to look for: "dentista", "loja de móveis planejados". */
  termo: string
  cidade: string
  uf: string
  /** Neighbourhoods: one search each, to get past a search's ceiling. */
  bairros?: string[]
  nota_min?: number
  nota_max?: number
  avaliacoes_min?: number
  site?: 'todos' | 'com' | 'sem'
  com_telefone?: boolean
  so_celular?: boolean
}

export type ExtractionFilters = CnpjFilters | MapsFilters

/** At most this many results in one extraction, per source. */
export const MAX_PER_EXTRACTION: Record<ExtractionSource, number> = {
  cnpj: 2000,
  google_maps: 500,
}

/** Leads a CRM may extract in a month when the agency set no ceiling. */
export const DEFAULT_MONTHLY_LIMIT = 2000

/** Results never sent to the CRM are deleted after this many days. */
export const UNUSED_RESULTS_DAYS = 90

export const MIGRATION_PENDING =
  'O Extrator de leads ainda não está ativo neste CRM (falta aplicar a migration 073).'

export const PORTE_LABEL: Record<string, string> = {
  '01': 'Microempresa',
  '03': 'Pequeno porte',
  '05': 'Demais',
  '00': 'Não informado',
}

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const
