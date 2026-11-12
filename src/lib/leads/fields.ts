// ============================================================
// What of a lead becomes a custom field — pure, unit-tested, no I/O.
//
// Each entry is one field of the contact: its label (the custom
// field's name when the ingest has to create it), its folded key (how
// it matches an existing field and the "de/para") and its value.
//
//   campos      "ticket_medio": "5000"            → Ticket medio
//   UF          contato.uf                        → UF
//   respostas   "Qual seu faturamento?": "50 mil" → Qual seu faturamento?
//   campanha    nome / conjunto / anúncio         → Campanha / Conjunto / Anúncio
//   qualificação rota / pontuação                 → Rota / Pontuação
//
// UTMs and click ids stay in the note only: they are technical, and a
// field per UTM would bury the ones a person reads.
//
// Shared by the ingest (lib/leads/ingest.ts) and the "de/para" screen,
// so both agree on every key.
// ============================================================

import { foldKey, type NormalizedLead } from './parse'

/** Custom field names longer than this are cut (renameable later). */
export const MAX_FIELD_NAME = 60

export type LeadFieldOrigin = 'campo' | 'resposta' | 'campanha' | 'qualificacao'

export interface LeadFieldEntry {
  /** Folded label: matches existing fields and the de/para keys. */
  key: string
  /** The field's name when it has to be created. */
  label: string
  value: string
  origin: LeadFieldOrigin
}

/** Short keys that read as initials: "uf" → "UF". */
const ACRONYMS = new Set(['uf', 'cpf', 'cnpj', 'cep', 'rg', 'crm', 'cro', 'oab', 'utm', 'id'])

/**
 * A readable field name from an incoming key or question.
 *
 *   "ticket_medio"           → "Ticket medio"
 *   "contato.cargo"          → "Contato cargo"
 *   "uf"                     → "UF"
 *   "Qual o seu faturamento?" → unchanged
 */
export function fieldLabel(raw: string): string {
  let label = raw.replace(/\s+/g, ' ').trim()
  const technical = !/\s/.test(label) && /[_.]/.test(label)
  if (technical) label = label.replace(/[_.]+/g, ' ').trim()
  if (ACRONYMS.has(label.toLowerCase())) label = label.toUpperCase()
  else if (label === label.toLowerCase()) label = label.charAt(0).toUpperCase() + label.slice(1)
  if (label.length > MAX_FIELD_NAME) label = label.slice(0, MAX_FIELD_NAME).trimEnd()
  return label
}

const CAMPAIGN_FIELDS: [string, string][] = [
  ['nome', 'Campanha'],
  ['conjunto', 'Conjunto'],
  ['anuncio', 'Anúncio'],
]

/** Every field a lead carries, in a stable order; one entry per key. */
export function leadFieldEntries(lead: NormalizedLead): LeadFieldEntry[] {
  const out = new Map<string, LeadFieldEntry>()
  const add = (rawLabel: string, value: string | null | undefined, origin: LeadFieldOrigin) => {
    const v = (value ?? '').trim()
    if (!v) return
    const label = fieldLabel(rawLabel)
    const key = foldKey(label)
    if (!key) return
    // A later source of the same key wins, like a later answer would.
    out.delete(key)
    out.set(key, { key, label, value: v, origin })
  }

  for (const [k, v] of Object.entries(lead.fields)) add(k, v, 'campo')
  for (const a of lead.answers) add(a.pergunta, a.resposta, 'resposta')

  const campaignName = lead.campaignDetails.nome ?? lead.campaign
  for (const [k, label] of CAMPAIGN_FIELDS) {
    add(label, k === 'nome' ? campaignName : lead.campaignDetails[k], 'campanha')
  }

  if (lead.route) add('Rota', lead.route, 'qualificacao')
  if (lead.score !== null) add('Pontuação', String(lead.score), 'qualificacao')

  return Array.from(out.values())
}
