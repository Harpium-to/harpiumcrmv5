import { OTHER, UNASSIGNED } from './aggregate'
import { toCsv, type CsvColumn } from './csv'
import type { BreakdownRow, ReportBundle } from './types'

// ============================================================
// One report → a CSV document.
//
// The catalogue is shared with the screen, so a section the UI can
// show is a section you can export and vice versa — an export menu
// listing something the page doesn't have (or missing something it
// does) is the usual way these two drift.
//
// Headers are Portuguese, matching the contacts export that already
// ships. The app is bilingual, but a spreadsheet lands in a folder and
// gets opened months later by somebody who was never in the session
// that produced it, so the file does not inherit a UI language toggle.
// ============================================================

/** Labels for the keys the aggregation emits as sentinels. */
const KEY_LABELS: Record<string, string> = {
  [UNASSIGNED]: 'Sem informação',
  [OTHER]: 'Outros',
  // Forecast buckets.
  overdue: 'Data vencida',
  this_month: 'Este mês',
  next_month: 'Mês que vem',
  later: 'Mais adiante',
  undated: 'Sem data prevista',
  // Who answered first.
  agent: 'Pessoa',
  bot: 'IA / fluxo',
  // Conversation status.
  open: 'Aberta',
  pending: 'Pendente',
  closed: 'Fechada',
  // Contact temperature.
  cold: 'Frio',
  warm: 'Morno',
  hot: 'Quente',
  // Task kinds.
  outreach: 'Abordagem',
  followup: 'Retomada',
  negotiate: 'Negociação',
  close: 'Fechamento',
  onboard: 'Onboarding',
  reply: 'Resposta',
  research: 'Pesquisa',
  qualify: 'Qualificação',
  prospect: 'Prospecção',
}

export function labelForKey(key: string, fallbackLabel: string): string {
  if (fallbackLabel && fallbackLabel.trim()) return fallbackLabel
  return KEY_LABELS[key] ?? key
}

const breakdownColumns = (
  firstHeader: string,
  valueHeader: string | null,
): CsvColumn<BreakdownRow>[] => {
  const columns: CsvColumn<BreakdownRow>[] = [
    { header: firstHeader, value: (r) => labelForKey(r.key, r.label) },
    { header: 'Quantidade', value: (r) => r.count },
  ]
  if (valueHeader) {
    columns.push({ header: valueHeader, value: (r) => r.value ?? 0 })
  }
  return columns
}

export type ExportId =
  | 'funnel'
  | 'deals_by_owner'
  | 'forecast'
  | 'deals_by_day'
  | 'contacts_by_day'
  | 'contacts_by_source'
  | 'contacts_by_temperature'
  | 'contacts_by_segment'
  | 'messages_by_day'
  | 'conversations_by_status'
  | 'first_response_by_day'
  | 'agent_runs'
  | 'agent_tasks'
  | 'agent_cost'
  | 'agent_goals'

export const EXPORT_IDS: ExportId[] = [
  'funnel',
  'deals_by_owner',
  'forecast',
  'deals_by_day',
  'contacts_by_day',
  'contacts_by_source',
  'contacts_by_temperature',
  'contacts_by_segment',
  'messages_by_day',
  'conversations_by_status',
  'first_response_by_day',
  'agent_runs',
  'agent_tasks',
  'agent_cost',
  'agent_goals',
]

export function isExportId(value: unknown): value is ExportId {
  return typeof value === 'string' && (EXPORT_IDS as string[]).includes(value)
}

const PERCENT = (ratio: number | null) =>
  ratio === null ? '' : `${Math.round(ratio * 1000) / 10}%`

/**
 * Serialise one section of a loaded bundle.
 *
 * Returns null for a section this database cannot answer — the agent
 * sections before migrations 044/045, say. The caller turns that into
 * a 409 rather than handing someone an empty file they would read as
 * "we did nothing this month".
 */
export function exportReport(
  id: ExportId,
  bundle: ReportBundle,
): { filenamePart: string; csv: string } | null {
  switch (id) {
    case 'funnel':
      return {
        filenamePart: 'funil-por-etapa',
        csv: toCsv(bundle.funnel, breakdownColumns('Etapa', 'Valor em aberto')),
      }
    case 'deals_by_owner':
      return {
        filenamePart: 'ganhos-por-responsavel',
        csv: toCsv(
          bundle.dealsByOwner,
          breakdownColumns('Responsável', 'Valor ganho'),
        ),
      }
    case 'forecast':
      return {
        filenamePart: 'previsao-de-fechamento',
        csv: toCsv(bundle.forecast, [
          { header: 'Previsão', value: (r) => labelForKey(r.bucket, '') },
          { header: 'Negócios', value: (r) => r.count },
          { header: 'Valor', value: (r) => r.value },
        ]),
      }
    case 'deals_by_day':
      return {
        filenamePart: 'fechamentos-por-dia',
        csv: toCsv(bundle.dealsByDay, [
          { header: 'Dia', value: (r) => r.day },
          { header: 'Ganhos', value: (r) => r.a },
          { header: 'Perdidos', value: (r) => r.b },
        ]),
      }
    case 'contacts_by_day':
      return {
        filenamePart: 'leads-por-dia',
        csv: toCsv(bundle.contactsByDay, [
          { header: 'Dia', value: (r) => r.day },
          { header: 'Leads novos', value: (r) => r.value },
        ]),
      }
    case 'contacts_by_source':
      return {
        filenamePart: 'leads-por-origem',
        csv: toCsv(bundle.contactsBySource, breakdownColumns('Origem', null)),
      }
    case 'contacts_by_temperature':
      return {
        filenamePart: 'leads-por-temperatura',
        csv: toCsv(
          bundle.contactsByTemperature,
          breakdownColumns('Temperatura', 'Soma do potencial'),
        ),
      }
    case 'contacts_by_segment':
      return {
        filenamePart: 'leads-por-segmento',
        csv: toCsv(bundle.contactsBySegment, breakdownColumns('Segmento', null)),
      }
    case 'messages_by_day':
      return {
        filenamePart: 'mensagens-por-dia',
        csv: toCsv(bundle.messagesByDay, [
          { header: 'Dia', value: (r) => r.day },
          { header: 'Recebidas', value: (r) => r.a },
          { header: 'Enviadas', value: (r) => r.b },
        ]),
      }
    case 'conversations_by_status':
      return {
        filenamePart: 'conversas-por-status',
        csv: toCsv(
          bundle.conversationsByStatus,
          breakdownColumns('Status', null),
        ),
      }
    case 'first_response_by_day':
      if (!bundle.firstResponse) return null
      return {
        filenamePart: 'primeira-resposta-por-dia',
        csv: toCsv(bundle.firstResponse.byDay, [
          { header: 'Dia', value: (r) => r.day },
          { header: 'Esperas respondidas', value: (r) => r.replied },
          // Empty, not 0: a day nobody wrote in has no wait to measure.
          {
            header: 'Mediana (min)',
            value: (r) => (r.medianMinutes === null ? '' : r.medianMinutes),
          },
        ]),
      }
    case 'agent_runs':
      if (!bundle.agents) return null
      return {
        filenamePart: 'execucoes-por-agente',
        csv: toCsv(bundle.agents.runs, [
          { header: 'Agente', value: (r) => r.agentName },
          { header: 'Respondidas', value: (r) => r.replied },
          { header: 'Repassadas', value: (r) => r.handoff },
          { header: 'Ignoradas', value: (r) => r.skipped },
          { header: 'Com erro', value: (r) => r.failed },
          { header: 'Tokens', value: (r) => r.tokens },
          {
            header: 'Duração média (s)',
            value: (r) =>
              r.avgDurationMs === null
                ? ''
                : Math.round(r.avgDurationMs / 100) / 10,
          },
        ]),
      }
    case 'agent_tasks':
      if (!bundle.agents) return null
      return {
        filenamePart: 'tarefas-por-tipo',
        csv: toCsv(bundle.agents.tasksByKind, breakdownColumns('Tipo', null)),
      }
    case 'agent_cost':
      if (!bundle.agents) return null
      return {
        filenamePart: 'custo-por-agente',
        csv: toCsv(bundle.agents.cost, [
          { header: 'Agente', value: (r) => r.agentName || 'Agente removido' },
          { header: 'Tarefas', value: (r) => r.tasks },
          { header: 'Tokens', value: (r) => r.tokens },
          // Six decimals: per-task spend is fractions of a cent, and
          // rounding to two would show every row as 0.00.
          { header: 'Custo (USD)', value: (r) => r.costUsd.toFixed(6) },
        ]),
      }
    case 'agent_goals':
      if (!bundle.agents) return null
      return {
        filenamePart: 'atingimento-de-metas',
        csv: toCsv(bundle.agents.goals, [
          { header: 'Agente', value: (r) => r.agentName },
          { header: 'Meta', value: (r) => r.metricId },
          { header: 'Alvo no período', value: (r) => r.target },
          // Empty, not 0: this metric has no source to count from, and
          // a 0 in a spreadsheet is indistinguishable from a failure.
          { header: 'Realizado', value: (r) => (r.measured ? r.actual : '') },
          { header: 'Atingimento', value: (r) => PERCENT(r.ratio) },
          {
            header: 'Observação',
            value: (r) => (r.measured ? '' : 'Sem fonte de medição'),
          },
        ]),
      }
  }
}
