// ============================================================
// The report of a quiz, worked out from its visits (quiz_sessions).
//
//   - how many opened the link, started, finished and became leads;
//   - the funnel: how many reached each screen and how many stopped
//     on it — the answer to "where do people give up";
//   - what was answered to each choice question;
//   - which campaign and which creative brought the visits, and how
//     many of them ended qualified;
//   - one line per person, including who stopped halfway and where.
//
// Pure — no I/O. The route reads the rows; this turns them into the
// numbers, so the same code feeds the screen, the CSV and the agency's
// view of a client's quiz.
// ============================================================

import { answerLabel, formatPhone, funnelScreens } from './engine'
import { INTRO_STEP, RESULT_STEP, type QuizAnswers, type QuizDefinition, type QuizRoute } from './types'

/** The columns of quiz_sessions the report reads. */
export interface ReportSession {
  id: string
  steps: string[]
  last_step: string | null
  answers: QuizAnswers
  contact: Record<string, string>
  result_id: string | null
  route: QuizRoute | null
  utms: Record<string, string>
  device: 'mobile' | 'desktop' | null
  started_at: string | null
  completed_at: string | null
  cta_clicks: number
  lead_id: string | null
  contact_id: string | null
  lead_status: string | null
  created_at: string
}

export const REPORT_COLUMNS =
  'id, steps, last_step, answers, contact, result_id, route, utms, device, started_at, completed_at, cta_clicks, lead_id, contact_id, lead_status, created_at'

export const NO_CAMPAIGN = '(sem campanha)'
export const NO_CREATIVE = '(sem criativo)'

export interface ReportFilter {
  campaign?: string
  creative?: string
}

const campaignOf = (s: ReportSession) => s.utms?.utm_campaign || NO_CAMPAIGN
const creativeOf = (s: ReportSession) => s.utms?.utm_content || NO_CREATIVE

export function applyFilter(sessions: ReportSession[], filter: ReportFilter): ReportSession[] {
  return sessions.filter(
    (s) =>
      (!filter.campaign || campaignOf(s) === filter.campaign) &&
      (!filter.creative || creativeOf(s) === filter.creative),
  )
}

// ------------------------------------------------------------
// Numbers
// ------------------------------------------------------------

export interface FunnelRow {
  id: string
  label: string
  kind: 'intro' | 'step' | 'result'
  /** Visits that saw this screen. */
  reached: number
  /** Visits that stopped on it (saw it, went no further, never finished). */
  stopped: number
  /** Only some visitors are shown this screen. */
  conditional: boolean
}

export interface SourceRow {
  key: string
  visits: number
  completed: number
  leads: number
  /** Finished with a result marked qualified (route A). */
  qualified: number
}

export interface QuizReport {
  totals: {
    visits: number
    started: number
    completed: number
    leads: number
    qualified: number
    /** Clicks on the result screen's button. */
    ctaClicks: number
    /** Visits that clicked it at least once. */
    ctaVisits: number
    /** Typical time from opening to finishing, in seconds. */
    medianSeconds: number | null
  }
  results: { id: string; name: string; route: QuizRoute; count: number }[]
  funnel: FunnelRow[]
  answers: {
    stepId: string
    label: string
    /** Visits that answered it. */
    total: number
    options: { id: string; label: string; count: number }[]
  }[]
  campaigns: SourceRow[]
  creatives: SourceRow[]
  devices: { key: 'mobile' | 'desktop' | 'unknown'; visits: number; completed: number }[]
  /** Every campaign and creative seen, for the filter menus. */
  choices: { campaigns: string[]; creatives: string[] }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function bySource(sessions: ReportSession[], keyOf: (s: ReportSession) => string): SourceRow[] {
  const rows = new Map<string, SourceRow>()
  for (const s of sessions) {
    const key = keyOf(s)
    const row = rows.get(key) ?? { key, visits: 0, completed: 0, leads: 0, qualified: 0 }
    row.visits += 1
    if (s.completed_at) row.completed += 1
    if (s.lead_id) row.leads += 1
    if (s.completed_at && s.route === 'A') row.qualified += 1
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => b.visits - a.visits || a.key.localeCompare(b.key))
}

function screenLabel(def: QuizDefinition, id: string): string {
  if (id === INTRO_STEP) return 'Abriu a página'
  if (id === RESULT_STEP) return 'Concluiu (viu o resultado)'
  return def.steps.find((s) => s.id === id)?.label ?? id
}

/**
 * `all` are the visits of the period; the campaign and creative
 * filters narrow every number, but the filter menus still list every
 * campaign and creative of the period.
 */
export function buildReport(
  def: QuizDefinition,
  all: ReportSession[],
  filter: ReportFilter = {},
): QuizReport {
  const sessions = applyFilter(all, filter)
  const done = sessions.filter((s) => s.completed_at)

  const seconds = done
    .map((s) => (new Date(s.completed_at!).getTime() - new Date(s.created_at).getTime()) / 1000)
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 6 * 3600)
    .map(Math.round)

  const funnel: FunnelRow[] = funnelScreens(def).map((id) => {
    const step = def.steps.find((s) => s.id === id)
    return {
      id,
      label: screenLabel(def, id),
      kind: id === INTRO_STEP ? 'intro' : id === RESULT_STEP ? 'result' : 'step',
      reached:
        id === RESULT_STEP ? done.length : sessions.filter((s) => s.steps.includes(id)).length,
      stopped:
        id === RESULT_STEP
          ? 0
          : sessions.filter((s) => !s.completed_at && s.last_step === id).length,
      conditional: Boolean(step?.showIf?.length),
    }
  })

  const answers: QuizReport['answers'] = []
  for (const step of def.steps) {
    if (step.type !== 'choice') continue
    const counts = new Map<string, number>(step.options.map((o) => [o.id, 0]))
    let total = 0
    for (const s of sessions) {
      const answer = s.answers?.[step.id]
      if (answer === undefined) continue
      const chosen = Array.isArray(answer) ? answer : [answer]
      const known = chosen.filter((id) => counts.has(id))
      if (known.length === 0) continue
      total += 1
      for (const id of known) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    answers.push({
      stepId: step.id,
      label: step.label,
      total,
      options: step.options.map((o) => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0 })),
    })
  }

  const deviceRows = new Map<string, { visits: number; completed: number }>()
  for (const s of sessions) {
    const key = s.device ?? 'unknown'
    const row = deviceRows.get(key) ?? { visits: 0, completed: 0 }
    row.visits += 1
    if (s.completed_at) row.completed += 1
    deviceRows.set(key, row)
  }

  return {
    totals: {
      visits: sessions.length,
      started: sessions.filter((s) => s.started_at).length,
      completed: done.length,
      leads: sessions.filter((s) => s.lead_id).length,
      qualified: done.filter((s) => s.route === 'A').length,
      ctaClicks: sessions.reduce((sum, s) => sum + (s.cta_clicks ?? 0), 0),
      ctaVisits: sessions.filter((s) => (s.cta_clicks ?? 0) > 0).length,
      medianSeconds: median(seconds),
    },
    results: def.results.map((r) => ({
      id: r.id,
      name: r.name,
      route: r.route,
      count: done.filter((s) => s.result_id === r.id).length,
    })),
    funnel,
    answers,
    campaigns: bySource(sessions, campaignOf),
    creatives: bySource(sessions, creativeOf),
    devices: (['mobile', 'desktop', 'unknown'] as const)
      .map((key) => ({ key, ...(deviceRows.get(key) ?? { visits: 0, completed: 0 }) }))
      .filter((d) => d.visits > 0),
    choices: {
      campaigns: [...new Set(all.map(campaignOf))].sort(),
      creatives: [...new Set(all.map(creativeOf))].sort(),
    },
  }
}

// ------------------------------------------------------------
// People
// ------------------------------------------------------------

export interface PersonRow {
  id: string
  at: string
  name: string
  phone: string
  email: string
  company: string
  city: string
  instagram: string
  /** Finished, or stopped halfway. */
  done: boolean
  resultId: string | null
  resultName: string
  route: QuizRoute | null
  /** The screen where a visit that did not finish stopped. */
  stoppedAt: string
  campaign: string
  creative: string
  source: string
  device: string
  /** 'ok' | 'parcial' | 'sem_contato' | 'erro' | '' */
  leadStatus: string
  contactId: string | null
  ctaClicks: number
  /** Question label → answer, in the quiz's order. */
  answers: { question: string; answer: string }[]
}

const DEVICE_LABEL: Record<string, string> = { mobile: 'Celular', desktop: 'Computador' }

export function buildPeople(def: QuizDefinition, sessions: ReportSession[]): PersonRow[] {
  const resultName = new Map(def.results.map((r) => [r.id, r.name]))
  return sessions.map((s) => {
    const contact = s.contact ?? {}
    const answers: PersonRow['answers'] = []
    for (const step of def.steps) {
      if (step.type === 'choice') {
        const said = answerLabel(step, s.answers?.[step.id])
        if (said) answers.push({ question: step.label, answer: said })
      } else if (step.type === 'fields') {
        for (const field of step.fields) {
          if (!['text', 'longtext', 'number'].includes(field.kind)) continue
          const value = s.answers?.[field.id]
          if (typeof value === 'string' && value) answers.push({ question: field.label, answer: value })
        }
      }
    }
    return {
      id: s.id,
      at: s.created_at,
      name: contact.name ?? '',
      phone: contact.phone ? formatPhone(contact.phone) : '',
      email: contact.email ?? '',
      company: contact.company ?? '',
      city: contact.city ?? '',
      instagram: contact.instagram ?? '',
      done: Boolean(s.completed_at),
      resultId: s.result_id,
      resultName: s.result_id ? (resultName.get(s.result_id) ?? 'Resultado removido') : '',
      route: s.route,
      stoppedAt: s.completed_at ? '' : screenLabel(def, s.last_step ?? INTRO_STEP),
      campaign: s.utms?.utm_campaign ?? '',
      creative: s.utms?.utm_content ?? '',
      source: s.utms?.utm_source ?? '',
      device: DEVICE_LABEL[s.device ?? ''] ?? '',
      leadStatus: s.lead_status ?? '',
      contactId: s.contact_id,
      ctaClicks: s.cta_clicks ?? 0,
      answers,
    }
  })
}

export const LEAD_STATUS_LABEL: Record<string, string> = {
  ok: 'Lead no CRM',
  parcial: 'Lead parcial no CRM',
  sem_contato: 'Sem telefone nem e-mail',
  erro: 'Falhou ao gravar (nova tentativa automática)',
}

/** The people as rows for the CSV: fixed columns, then one per question. */
export function peopleTable(
  def: QuizDefinition,
  people: PersonRow[],
): { headers: string[]; rows: string[][] } {
  const questions: string[] = []
  for (const step of def.steps) {
    if (step.type === 'choice') questions.push(step.label)
    else if (step.type === 'fields') {
      for (const field of step.fields) {
        if (['text', 'longtext', 'number'].includes(field.kind)) questions.push(field.label)
      }
    }
  }
  const unique = [...new Set(questions)]
  const headers = [
    'Data',
    'Nome',
    'WhatsApp',
    'E-mail',
    'Empresa',
    'Cidade',
    'Instagram',
    'Situação',
    'Resultado',
    'Parou em',
    'Lead',
    'Campanha',
    'Criativo',
    'Origem',
    'Aparelho',
    'Cliques no botão',
    ...unique,
  ]
  const rows = people.map((p) => {
    const said = new Map(p.answers.map((a) => [a.question, a.answer]))
    return [
      p.at,
      p.name,
      p.phone,
      p.email,
      p.company,
      p.city,
      p.instagram,
      p.done ? 'Concluiu' : 'Parou no meio',
      p.resultName,
      p.stoppedAt,
      LEAD_STATUS_LABEL[p.leadStatus] ?? '',
      p.campaign,
      p.creative,
      p.source,
      p.device,
      String(p.ctaClicks),
      ...unique.map((q) => said.get(q) ?? ''),
    ]
  })
  return { headers, rows }
}

// ------------------------------------------------------------
// Period
// ------------------------------------------------------------

export const REPORT_PERIODS = ['today', '7', '30', '90', 'all'] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number]

/** Read `?since=` as a date, refusing anything that is not one. */
export function parseSince(value: string | null): string | null {
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}
