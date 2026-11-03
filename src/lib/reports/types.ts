// ============================================================
// Result shapes the report screen and the exporters consume.
//
// Every one of these carries its own emptiness. `rows: []` plus a
// `measured` flag is not the same as "zero", and the UI has to be able
// to tell the difference: a funnel with no deals is an empty pipeline,
// while a funnel the query could not read (tables from a migration
// nobody applied yet) is a broken screen pretending to be an empty
// one. The second must never render as the first.
// ============================================================

export interface Delta {
  current: number
  previous: number
}

/** A bar/line series bucket keyed by local day. */
export interface DayPoint {
  day: string
  value: number
}

export interface TwoSeriesDayPoint {
  day: string
  a: number
  b: number
}

/** One row of a breakdown: "por origem", "por etapa", "por agente". */
export interface BreakdownRow {
  key: string
  /** Already resolved for display — a stage name, an agent name. */
  label: string
  count: number
  /** Money or another summed measure; null when the cut has none. */
  value: number | null
}

// ------------------------------------------------------------
// Comercial
// ------------------------------------------------------------

export interface DealOutcome {
  wonCount: Delta
  wonValue: Delta
  lostCount: Delta
  /** Won / (won + lost), 0–1. Null when nothing closed in the window. */
  winRate: number | null
  /** Won value / won count. Null when nothing was won. */
  averageTicket: number | null
  /**
   * True when the window starts before migration 046 ran, which means
   * some close dates are `updated_at` guesses rather than real stamps.
   * Surfaced, not hidden — see the migration header.
   */
  approximate: boolean
}

export interface ForecastBucket {
  /** overdue | this_month | next_month | later | undated */
  bucket: string
  count: number
  value: number
}

// ------------------------------------------------------------
// Agentes
// ------------------------------------------------------------

export interface AgentRunTotals {
  agentId: string
  agentName: string
  replied: number
  handoff: number
  skipped: number
  failed: number
  /** Sum of `total_tokens` over the window. */
  tokens: number
  /** Mean run duration in ms, over runs that finished. */
  avgDurationMs: number | null
}

export interface AgentCostRow {
  agentId: string
  agentName: string
  /** Attributed task spend inside the window, in USD. */
  costUsd: number
  tokens: number
  tasks: number
}

export interface GoalAttainmentRow {
  agentId: string
  agentName: string
  metricId: string
  /** Null when the catalogue has no label for a factory-minted key. */
  metricLabelKey: string | null
  /** The target, normalised to the window. */
  target: number
  /** What actually happened, or null when the metric has no source. */
  actual: number | null
  /** actual / target, or null when unmeasured. */
  ratio: number | null
  /** False when the schema has nothing to count — never render 0%. */
  measured: boolean
}

export interface ApprovalTotals {
  pending: number
  approved: number
  rejected: number
  expired: number
  /** Median minutes from request to decision; null with no decisions. */
  medianDecisionMinutes: number | null
}

export interface FirstResponseDay {
  day: string
  replied: number
  /** Null on a day with no answered wait — not 0, which would mean "instant". */
  medianMinutes: number | null
}

export interface FirstResponseSummary {
  /** Waits that got an answer. */
  replied: number
  /** Waits still without one — counted apart, never as zero minutes. */
  unreplied: number
  medianMinutes: number | null
  p90Minutes: number | null
  /** By who answered: `agent` (a person) and `bot` (AI reply or flow). */
  byResponder: { responder: string; replied: number; medianMinutes: number | null }[]
  /** One point per range day, same x-axis as every other daily series. */
  byDay: FirstResponseDay[]
}

// ------------------------------------------------------------
// The bundle one page load needs
// ------------------------------------------------------------

export interface ReportBundle {
  /** Echo of the resolved window, so the UI labels what it is showing. */
  range: { fromIso: string; toIso: string; timezone: string; dayKeys: string[] }
  currency: string
  deals: DealOutcome
  dealsByDay: TwoSeriesDayPoint[]
  funnel: BreakdownRow[]
  dealsByOwner: BreakdownRow[]
  forecast: ForecastBucket[]
  contactsByDay: DayPoint[]
  contactsBySource: BreakdownRow[]
  contactsByTemperature: BreakdownRow[]
  contactsBySegment: BreakdownRow[]
  messagesByDay: TwoSeriesDayPoint[]
  conversationsByStatus: BreakdownRow[]
  /** Null until migration 048 adds `report_first_response`. */
  firstResponse: FirstResponseSummary | null
  /**
   * Null when the agent tables are not there yet (044/045 unapplied).
   * The section is then absent rather than zeroed.
   */
  agents: {
    runs: AgentRunTotals[]
    tasksByKind: BreakdownRow[]
    cost: AgentCostRow[]
    goals: GoalAttainmentRow[]
    approvals: ApprovalTotals
  } | null
}
