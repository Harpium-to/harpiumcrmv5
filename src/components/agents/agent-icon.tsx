import {
  BookOpen,
  Bot,
  Briefcase,
  CalendarClock,
  Crown,
  Filter,
  Handshake,
  Headset,
  HeartHandshake,
  History,
  MessageSquare,
  Radar,
  Receipt,
  Search,
  Send,
  Share2,
  FileText,
  Users,
  GitBranch,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { AGENT_ROLES } from "@/lib/agents/roles";
import { AGENT_TOOLS } from "@/lib/agents/tools";

/**
 * Icon name → component.
 *
 * `roles.ts` and `tools.ts` are plain data shared with server code, so
 * they name their icon as a string. This is the one place that turns
 * those strings back into components, on the client side of the line.
 *
 * Exported as records rather than behind `iconFor(x)` helpers: the
 * React Compiler lint cannot tell a function that *returns* an
 * existing component from one that *creates* a new one each render,
 * and flags the latter. A property read is unambiguous.
 */
const BY_NAME: Record<string, LucideIcon> = {
  BookOpen,
  Briefcase,
  CalendarClock,
  Crown,
  FileText,
  Filter,
  GitBranch,
  Handshake,
  Headset,
  HeartHandshake,
  History,
  MessageSquare,
  Radar,
  Receipt,
  Search,
  Send,
  Share2,
  Users,
  Wrench,
};

export const FALLBACK_AGENT_ICON: LucideIcon = Bot;

/**
 * Keyed by `agents.role` first, then by `agents.department` — a custom
 * agent has role 'custom' but may still sit in a known department, and
 * showing it the department's icon beats showing every custom agent
 * the same generic bot.
 */
export const AGENT_ICONS: Record<string, LucideIcon> = (() => {
  const map: Record<string, LucideIcon> = {};
  for (const role of AGENT_ROLES) {
    const icon = BY_NAME[role.icon] ?? FALLBACK_AGENT_ICON;
    map[role.id] = icon;
    // Several roles share a department (prospector/researcher/sdr all
    // sit in "prospeccao"); first one in wins, which is the order the
    // catalogue declares them.
    if (!map[role.department]) map[role.department] = icon;
  }
  return map;
})();

export const TOOL_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  AGENT_TOOLS.map((tool) => [tool.id, BY_NAME[tool.icon] ?? FALLBACK_AGENT_ICON]),
);

/**
 * The icon for an agent, preferring its job title over its department.
 * Returns a component reference from the records above — never builds
 * one — so call sites can read it during render.
 */
export function iconKeyFor(agent: { role?: string; department: string }): string {
  if (agent.role && AGENT_ICONS[agent.role]) return agent.role;
  return agent.department;
}
