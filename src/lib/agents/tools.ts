// ============================================================
// The capability vocabulary.
//
// A tool is a group of actions an operator grants as one decision.
// `autonomy.ts` maps each action to the tool that unlocks it; this
// file is the catalogue the UI renders and the presets draw from.
//
// Granting is explicit and additive: an agent starts with nothing and
// is handed capabilities. The alternative (everything on, revoke what
// you don't want) means every new tool we ship silently lands in the
// hands of every existing agent.
// ============================================================

export interface ToolMeta {
  id: string
  /** Indexes the `Agents` namespace in messages/*.json. */
  labelKey: string
  descriptionKey: string
  /** Lucide icon name, resolved by the UI. */
  icon: string
}

export const AGENT_TOOLS: ToolMeta[] = [
  {
    id: 'research',
    labelKey: 'toolResearch',
    descriptionKey: 'toolResearchDesc',
    icon: 'Search',
  },
  {
    id: 'crm',
    labelKey: 'toolCrm',
    descriptionKey: 'toolCrmDesc',
    icon: 'Users',
  },
  {
    id: 'pipeline',
    labelKey: 'toolPipeline',
    descriptionKey: 'toolPipelineDesc',
    icon: 'GitBranch',
  },
  {
    id: 'messaging',
    labelKey: 'toolMessaging',
    descriptionKey: 'toolMessagingDesc',
    icon: 'MessageSquare',
  },
  {
    id: 'calendar',
    labelKey: 'toolCalendar',
    descriptionKey: 'toolCalendarDesc',
    icon: 'CalendarClock',
  },
  {
    id: 'proposals',
    labelKey: 'toolProposals',
    descriptionKey: 'toolProposalsDesc',
    icon: 'FileText',
  },
  {
    id: 'delegation',
    labelKey: 'toolDelegation',
    descriptionKey: 'toolDelegationDesc',
    icon: 'Share2',
  },
  {
    id: 'knowledge',
    labelKey: 'toolKnowledge',
    descriptionKey: 'toolKnowledgeDesc',
    icon: 'BookOpen',
  },
]

export const TOOL_IDS = AGENT_TOOLS.map((t) => t.id)

/** Drop anything not in the catalogue — the column is a free text[]. */
export function sanitizeTools(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item === 'string' && TOOL_IDS.includes(item)) seen.add(item)
  }
  return [...seen]
}

/** Channels an agent may speak on. */
export const AGENT_CHANNELS = ['whatsapp', 'instagram', 'email'] as const
export type AgentChannel = (typeof AGENT_CHANNELS)[number]

export function sanitizeChannels(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : []
  const seen = new Set<string>()
  for (const item of raw) {
    if (
      typeof item === 'string' &&
      (AGENT_CHANNELS as readonly string[]).includes(item)
    ) {
      seen.add(item)
    }
  }
  return [...seen]
}
