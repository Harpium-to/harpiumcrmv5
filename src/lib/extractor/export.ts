import type { CsvColumn } from '@/lib/reports/csv'

import type { ResultRow } from './store'
import { RESULT_STATUS_LABEL } from './types'

// ============================================================
// An extraction as a spreadsheet (CSV, which Excel opens: UTF-8 with
// BOM, formulas defused — src/lib/reports/csv.ts). Pure.
// ============================================================

const extra = (row: ResultRow, key: string): string | number | null => {
  const v = row.extras?.[key]
  return typeof v === 'string' || typeof v === 'number' ? v : null
}

export const RESULT_EXPORT_COLUMNS: CsvColumn<ResultRow>[] = [
  { header: 'Nome', value: (r) => r.name },
  { header: 'Telefone', value: (r) => r.phone },
  { header: 'Tipo de telefone', value: (r) => (r.phone_kind === 'celular' ? 'Celular' : r.phone_kind === 'fixo' ? 'Fixo' : '') },
  {
    header: 'Tem WhatsApp',
    value: (r) => (r.has_whatsapp === true ? 'Sim' : r.has_whatsapp === false ? 'Não' : ''),
  },
  { header: 'E-mail', value: (r) => r.email },
  { header: 'Site', value: (r) => r.website },
  { header: 'Instagram', value: (r) => r.instagram },
  { header: 'Atividade', value: (r) => r.activity },
  { header: 'Endereço', value: (r) => r.address },
  { header: 'Bairro', value: (r) => r.district },
  { header: 'Cidade', value: (r) => r.city },
  { header: 'UF', value: (r) => r.uf },
  { header: 'CEP', value: (r) => r.cep },
  { header: 'CNPJ', value: (r) => extra(r, 'cnpj') },
  { header: 'Razão social', value: (r) => extra(r, 'razao_social') },
  { header: 'Porte', value: (r) => extra(r, 'porte') },
  { header: 'Data de abertura', value: (r) => extra(r, 'abertura') },
  { header: 'Capital social', value: (r) => extra(r, 'capital') },
  { header: 'Responsável', value: (r) => extra(r, 'responsavel') },
  { header: 'Nota no Google', value: (r) => extra(r, 'nota') },
  { header: 'Avaliações no Google', value: (r) => extra(r, 'avaliacoes') },
  { header: 'Situação', value: (r) => RESULT_STATUS_LABEL[r.status] },
  { header: 'Contém dado pessoal', value: (r) => (r.kind === 'pessoa' ? 'Sim' : 'Não') },
  { header: 'No CRM', value: (r) => (r.imported_at ? 'Sim' : 'Não') },
]
