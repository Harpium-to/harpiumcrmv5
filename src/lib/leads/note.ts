// ============================================================
// The note a received lead leaves on its contact — pure, unit-tested.
//
// Everything that has no column of its own (quiz answers, extra form
// columns, UTMs, the route, consent) is written here, so the team and
// the AI agents read the lead's context right on the contact. The last
// line carries the lead id: it ties the note to "ver dados recebidos"
// and lets a reprocess tell that the note was already written.
// ============================================================

import type { NormalizedLead } from './parse'

const MARKER_PREFIX = 'Ref. do lead: '

/** The line that identifies which lead wrote a note. */
export function noteMarker(leadId: string): string {
  return `${MARKER_PREFIX}${leadId}`
}

const CAMPAIGN_LABEL: Record<string, string> = {
  nome: 'Campanha',
  conjunto: 'Conjunto',
  anuncio: 'Anúncio',
  plataforma: 'Plataforma',
  teste: 'Lead de teste',
  organico: 'Orgânico',
}

function formatWhen(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function originLabel(lead: NormalizedLead): string {
  if (lead.origin) return lead.origin
  if (lead.source === 'meta') return 'Meta'
  if (lead.source === 'google') return 'Google'
  return lead.source === 'other' ? 'formulário' : lead.source
}

export interface LeadNoteInput {
  lead: NormalizedLead
  leadId: string
  receivedAt: Date
  /** Fields that matched no custom field (or were mapped to the note). */
  extraFields: Record<string, string>
}

/**
 * The note text, or null when the lead carries nothing beyond the
 * contact columns — a bare name + phone doesn't need a note.
 */
export function buildLeadNote({ lead, leadId, receivedAt, extraFields }: LeadNoteInput): string | null {
  const sections: string[] = []

  const campaignParts: string[] = []
  if (lead.campaign && !lead.campaignDetails.nome) campaignParts.push(`Campanha: ${lead.campaign}`)
  for (const [k, v] of Object.entries(lead.campaignDetails)) {
    campaignParts.push(`${CAMPAIGN_LABEL[k] ?? k}: ${v}`)
  }
  const hasCampaignDetails = Object.keys(lead.campaignDetails).length > 0

  const qualification: string[] = []
  if (lead.route) qualification.push(`Rota ${lead.route}`)
  if (lead.qualified !== null) qualification.push(lead.qualified ? 'qualificado' : 'não qualificado')
  if (lead.score !== null) qualification.push(`pontuação ${lead.score}`)
  if (qualification.length || lead.reasons.length) {
    const lines = qualification.length ? [qualification.join(' · ')] : []
    if (lead.reasons.length) lines.push(`Motivos: ${lead.reasons.join('; ')}`)
    sections.push(lines.join('\n'))
  }

  if (lead.answers.length) {
    sections.push(
      ['Respostas', ...lead.answers.map((a) => `• ${a.pergunta}: ${a.resposta}`)].join('\n'),
    )
  }

  const extra = Object.entries(extraFields)
  if (extra.length) {
    sections.push(['Outros dados', ...extra.map(([k, v]) => `• ${k}: ${v}`)].join('\n'))
  }

  if (lead.note) sections.push(`Observação\n${lead.note}`)

  if (lead.consent) {
    const c = lead.consent
    const status =
      c.accepted === true ? 'aceito' : c.accepted === false ? 'recusado' : 'informado'
    let line = `Consentimento (LGPD): ${status}`
    if (c.at) line += ` em ${c.at}`
    if (c.text) line += ` — “${c.text}”`
    sections.push(line)
  }

  // Campaign data alone (UTMs on a plain lead) is still worth keeping:
  // it is the attribution the team asks about later.
  if (sections.length === 0 && !hasCampaignDetails) return null

  const header = [`Lead recebido · ${originLabel(lead)} · ${formatWhen(receivedAt)}`]
  if (campaignParts.length) header.push(campaignParts.join(' · '))

  return [header.join('\n'), ...sections, noteMarker(leadId)].join('\n\n')
}
