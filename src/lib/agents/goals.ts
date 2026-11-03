// ============================================================
// The goal vocabulary.
//
// `agents.goals` is `jsonb` shaped `{metric: number}` and
// `normalizeGoals` keeps it that way: non-negative integers, nothing
// nested. That leaves one question the column can't answer — twenty
// leads *per what?* — so the period is baked into the metric id
// (`leads_per_day`, not `leads` + a period column). A target read back
// from the database is therefore never ambiguous, and adding a new
// cadence is a line here rather than a migration.
//
// The ids match the ones the role templates already seed, so picking
// "Prospectador" off the shelf and opening the goals section shows the
// same twenty leads a day the template declared.
//
// This is a closed vocabulary on purpose. The agent factory may return
// any key it likes (`parseDraft` only checks the shape), and the
// column accepts it — so `goalLabelKey` returns null for anything
// unknown and the UI shows the raw key instead of crashing next-intl
// on a missing message.
// ============================================================

export type GoalPeriod = 'day' | 'week' | 'month'

/**
 * Where the *actual* for a target is counted from.
 *
 * `null` means the schema has nothing to count. Three of the metrics
 * below are in that state: there is no meetings table, no proposals
 * table, and `deals` carries no AI-agent attribution (only
 * `assigned_to`, which is a person). An operator can still set those
 * targets — the agent is told them and paces itself by them — but the
 * report has to say "sem fonte de medição" rather than render 0%.
 *
 * Showing 0% would be the worse bug of the two: it reads as an agent
 * failing completely, and somebody would switch off an agent that is
 * working fine. A metric with no source is a gap in the product, not a
 * gap in the agent's performance, and the two must not look alike.
 */
export type GoalSource =
  /** Runs this agent closed with a given outcome. */
  | { from: 'agent_runs'; status: 'replied' | 'handoff' }
  /** Queue tasks of a kind this agent completed. */
  | { from: 'agent_tasks'; kind: string }
  /** Contacts whose `owner_agent_id` is this agent. */
  | { from: 'contacts_owned' }
  | null

export interface AgentGoalMetric {
  /** Key inside `agents.goals`. */
  id: string
  /** Indexes the `Agents` namespace in messages/*.json. */
  labelKey: string
  period: GoalPeriod
  /** What the number counts, in Portuguese — for server-side prompts. */
  noun: string
  /** Starting value when an operator adds this metric. */
  suggested: number
  /** How the report measures it, or null when it cannot. */
  source: GoalSource
}

export const AGENT_GOAL_METRICS: AgentGoalMetric[] = [
  {
    id: 'leads_per_day',
    labelKey: 'goalLeadsPerDay',
    period: 'day',
    noun: 'leads novos',
    suggested: 20,
    source: { from: 'contacts_owned' },
  },
  {
    id: 'briefings_per_day',
    labelKey: 'goalBriefingsPerDay',
    period: 'day',
    noun: 'briefings de pesquisa',
    suggested: 20,
    source: { from: 'agent_tasks', kind: 'research' },
  },
  {
    id: 'conversations_per_day',
    labelKey: 'goalConversationsPerDay',
    period: 'day',
    noun: 'conversas atendidas',
    suggested: 15,
    source: { from: 'agent_runs', status: 'replied' },
  },
  {
    id: 'reviews_per_day',
    labelKey: 'goalReviewsPerDay',
    period: 'day',
    noun: 'análises da operação',
    suggested: 1,
    source: { from: 'agent_tasks', kind: 'qualify' },
  },
  {
    id: 'meetings_per_week',
    labelKey: 'goalMeetingsPerWeek',
    period: 'week',
    noun: 'reuniões agendadas',
    suggested: 5,
    source: null, // sem tabela de agenda
  },
  {
    id: 'recovered_per_week',
    labelKey: 'goalRecoveredPerWeek',
    period: 'week',
    noun: 'conversas retomadas',
    suggested: 5,
    source: { from: 'agent_tasks', kind: 'followup' },
  },
  {
    id: 'proposals_per_week',
    labelKey: 'goalProposalsPerWeek',
    period: 'week',
    noun: 'propostas enviadas',
    suggested: 8,
    source: null, // sem tabela de propostas
  },
  {
    id: 'checkins_per_week',
    labelKey: 'goalCheckinsPerWeek',
    period: 'week',
    noun: 'check-ins com clientes',
    suggested: 20,
    source: { from: 'agent_tasks', kind: 'onboard' },
  },
  {
    id: 'closes_per_month',
    labelKey: 'goalClosesPerMonth',
    period: 'month',
    noun: 'negócios fechados',
    suggested: 10,
    source: null, // deals não tem atribuição a agente IA
  },
]

const BY_ID = new Map(AGENT_GOAL_METRICS.map((m) => [m.id, m]))

export function findGoalMetric(id: string): AgentGoalMetric | undefined {
  return BY_ID.get(id)
}

/**
 * Never build a translation key by concatenating a stored value — the
 * factory can mint keys this catalogue has never heard of. Returns
 * null so the caller can fall back to showing the raw id.
 */
export function goalLabelKey(id: string): string | null {
  return BY_ID.get(id)?.labelKey ?? null
}

const PERIOD_PT: Record<GoalPeriod, string> = {
  day: 'por dia',
  week: 'por semana',
  month: 'por mês',
}

/**
 * The agent's targets as one Portuguese phrase, for the prompt.
 *
 * Server-side, so it can't reach next-intl — and it shouldn't: this
 * text is read by a model, not by the operator, and it has to say the
 * same thing regardless of which locale the person who configured the
 * agent happened to be using.
 *
 * An unknown key still renders (`30 x_per_fortnight`) rather than
 * being dropped, because a target the operator set and the agent never
 * hears about is worse than a clumsy sentence.
 */
export function describeGoals(goals: Record<string, number>): string | null {
  const parts: string[] = []
  for (const [id, value] of Object.entries(goals ?? {})) {
    if (!Number.isFinite(value) || value <= 0) continue
    const metric = BY_ID.get(id)
    parts.push(
      metric
        ? `${value} ${metric.noun} ${PERIOD_PT[metric.period]}`
        : `${value} ${id}`,
    )
  }
  return parts.length > 0 ? parts.join(', ') : null
}
