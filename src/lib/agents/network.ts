import { AGENT_ROLES, HANDOFF_CHAIN, roleLabelKey } from './roles'
import type { Agent } from './types'

// ============================================================
// Deriving the handoff graph.
//
// Nothing here is new configuration: `HANDOFF_CHAIN` already says who
// passes work to whom, and `agents.role` already says who fills which
// post. The network view is a reading of those two, so this file turns
// them into columns and the component only draws.
//
// Kept pure and separate because the interesting part is the layering,
// and layering is exactly the kind of thing that is easy to get wrong
// and impossible to check by looking at a screenshot.
// ============================================================

export interface NetworkSlot {
  /** `agents.role`. */
  role: string
  labelKey: string | null
  /** Who fills this post. Empty means the stage exists but nobody runs it. */
  agents: Agent[]
  /** Where this post sends finished work, or null if the line ends here. */
  next: string | null
  nextLabelKey: string | null
}

export interface AgentNetwork {
  /** Columns left to right, in handoff order. */
  lanes: NetworkSlot[][]
  /**
   * Agents outside the chain: the inbound desks (they answer whoever
   * writes in, they don't receive a handoff), oversight roles, and
   * anything custom.
   */
  loose: Agent[]
  /** Chain posts with nobody assigned at all. */
  empty: number
  /** Chain posts where every assigned agent is switched off. */
  uncovered: number
}

/** Declaration order in the catalogue, for a stable sort inside a column. */
const ROLE_ORDER = new Map(AGENT_ROLES.map((role, i) => [role.id, i]))

/**
 * Longest-path depth for every role in the chain.
 *
 * Relaxed |V| times rather than walked recursively: `HANDOFF_CHAIN` is
 * hand-maintained data, and a recursive walk over a chain someone
 * accidentally made circular (`a → b → a`) hangs the tab. Bounded
 * relaxation just stops improving. Twelve roles, so the cost is noise.
 */
function depths(): Map<string, number> {
  const edges: Array<[string, string]> = []
  for (const [from, to] of Object.entries(HANDOFF_CHAIN)) {
    if (to) edges.push([from, to])
  }
  const depth = new Map<string, number>()
  for (const role of Object.keys(HANDOFF_CHAIN)) depth.set(role, 0)
  for (const [, to] of edges) if (!depth.has(to)) depth.set(to, 0)

  for (let i = 0; i < depth.size; i += 1) {
    let moved = false
    for (const [from, to] of edges) {
      const candidate = (depth.get(from) ?? 0) + 1
      if (candidate > (depth.get(to) ?? 0)) {
        depth.set(to, candidate)
        moved = true
      }
    }
    if (!moved) break
  }
  return depth
}

/**
 * Build the graph for one account's team.
 *
 * A role that neither receives nor sends work — the commercial manager
 * reviews the operation, it isn't a station on the line — is not given
 * a column of its own. It would read as a stage work flows through,
 * which is the one thing this picture is supposed to get right.
 */
export function buildAgentNetwork(agents: Agent[]): AgentNetwork {
  const depth = depths()

  const hasOut = new Set<string>()
  const hasIn = new Set<string>()
  for (const [from, to] of Object.entries(HANDOFF_CHAIN)) {
    if (!to) continue
    hasOut.add(from)
    hasIn.add(to)
  }

  const byRole = new Map<string, Agent[]>()
  for (const agent of agents) {
    const list = byRole.get(agent.role)
    if (list) list.push(agent)
    else byRole.set(agent.role, [agent])
  }

  const chainRoles = [...depth.keys()].filter(
    (role) => hasOut.has(role) || hasIn.has(role),
  )

  const maxDepth = chainRoles.reduce(
    (max, role) => Math.max(max, depth.get(role) ?? 0),
    0,
  )

  const lanes: NetworkSlot[][] = []
  let empty = 0
  let uncovered = 0

  for (let d = 0; d <= maxDepth; d += 1) {
    const slots = chainRoles
      .filter((role) => (depth.get(role) ?? 0) === d)
      .sort(
        (a, b) =>
          (ROLE_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (ROLE_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
      .map((role) => {
        const filled = (byRole.get(role) ?? []).slice().sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
          return b.priority - a.priority
        })
        if (filled.length === 0) empty += 1
        if (!filled.some((a) => a.isActive)) uncovered += 1
        const next = HANDOFF_CHAIN[role] ?? null
        return {
          role,
          labelKey: roleLabelKey(role),
          agents: filled,
          next,
          nextLabelKey: next ? roleLabelKey(next) : null,
        }
      })
    if (slots.length > 0) lanes.push(slots)
  }

  const inChain = new Set(chainRoles)
  const loose = agents
    .filter((agent) => !inChain.has(agent.role))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return b.priority - a.priority
    })

  return { lanes, loose, empty, uncovered }
}
