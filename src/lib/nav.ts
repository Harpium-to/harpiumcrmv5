import {
  Activity,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  ChartColumn,
  GitBranch,
  LifeBuoy,
  LayoutDashboard,
  Magnet,
  MessageSquare,
  Plug,
  Radar as RadarIcon,
  Radio,
  Repeat,
  Settings,
  Share2,
  ShieldCheck,
  Users,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { AccountRole } from "@/lib/auth/roles";

// ============================================================
// The app's navigation registry.
//
// Lifted out of the sidebar when navigation split across two
// surfaces: the icon rail (which section of the app am I in) and the
// top bar's pill track (where am I inside this section). Both read
// from here, so adding a route is a one-line change in one file
// instead of a matched pair of edits that drift.
//
// `labelKey` indexes the `Sidebar` namespace in messages/*.json —
// the rail and the drawer show the same words, and the top bar
// falls back to them for its page title.
// ============================================================

/**
 * The menu's blocks, ordered by how often a client reaches for them
 * rather than by how the app was built:
 *   work   — the day's work, in the order a lead travels: inbox →
 *            leads → pipelines → agenda, with contacts (the address
 *            book) last
 *   track  — reading the numbers: reports and the radar
 *   build  — what you set up to run on its own
 *   system — what you set once: channels and settings
 */
export type NavGroup = "work" | "track" | "build" | "system";

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /**
   * The rail draws a hairline between groups (with the group's name
   * while it is open), and the phone drawer titles them. Sixteen
   * identical icons in one column is a wall.
   */
  group: NavGroup;
  /** Renders a small "Beta" chip in the drawer / tooltip. */
  beta?: boolean;
  /**
   * Reached from a button in the top bar rather than the desktop rail:
   * Ferramentas beside the agents chip, Notificações as the bell, Ajuda
   * as the "?". The mobile drawer still lists them, since the top bar's
   * chips do not all fit on a phone.
   */
  topbar?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, group: "work" },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare, group: "work" },
  { href: "/notifications", labelKey: "notifications", icon: Bell, group: "work", topbar: true },
  { href: "/leads", labelKey: "leads", icon: Magnet, group: "work" },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch, group: "work" },
  { href: "/agenda", labelKey: "agenda", icon: CalendarDays, group: "work" },
  { href: "/contacts", labelKey: "contacts", icon: Users, group: "work" },
  { href: "/relatorios", labelKey: "reports", icon: ChartColumn, group: "track" },
  { href: "/radar", labelKey: "radar", icon: RadarIcon, group: "track" },
  { href: "/agents", labelKey: "aiAgents", icon: Bot, group: "build" },
  { href: "/automations", labelKey: "automations", icon: Zap, group: "build" },
  { href: "/flows", labelKey: "flows", icon: Workflow, group: "build", beta: true },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio, group: "build" },
  { href: "/ferramentas", labelKey: "tools", icon: Wrench, group: "build", topbar: true },
  { href: "/canais", labelKey: "channels", icon: Plug, group: "system" },
  { href: "/settings", labelKey: "settings", icon: Settings, group: "system" },
  { href: "/ajuda", labelKey: "help", icon: LifeBuoy, group: "system", topbar: true },
];

export const NAV_GROUPS: NavGroup[] = ["work", "track", "build", "system"];

/** Each group's name, in the `Sidebar` namespace. */
export const NAV_GROUP_LABEL_KEYS: Record<NavGroup, string> = {
  work: "groupWork",
  track: "groupTrack",
  build: "groupBuild",
  system: "groupSystem",
};

/**
 * Which groups this person's menu shows.
 *
 * Attendants and viewers work the day; they cannot change agents,
 * automations, channels or settings, so those groups only make their
 * menu longer. This shortens the menu, it does not guard anything: the
 * pages still open from a link and enforce the role themselves.
 *
 * Two cases keep the whole menu:
 *   - the agency inside a client CRM (`viaAgency`): read-only consent
 *     makes it a viewer there, but checking that CRM's setup is the
 *     reason for the visit;
 *   - a role not loaded yet, so an owner's menu never loses half of
 *     its items for a moment on load.
 */
export function visibleNavGroups(
  role: AccountRole | null,
  viaAgency: boolean,
): NavGroup[] {
  if (viaAgency || role === null || role === "owner" || role === "admin") {
    return NAV_GROUPS;
  }
  return ["work", "track"];
}

/**
 * Which nav item owns a given pathname. `/dashboard` must match
 * exactly — every other route would otherwise lose to it on a prefix
 * test — and the rest match on prefix so `/flows/abc/runs` still
 * lights the Flows icon.
 */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.href === "/dashboard"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

export interface NavSection {
  /** Appended to the route as `?tab=` — the pages already read this. */
  value: string;
  labelKey: string;
  icon?: LucideIcon;
}

/**
 * Sub-sections for the top bar's pill track, keyed by nav href.
 *
 * Only routes with a genuine internal split appear here. A route with
 * no entry gets its page title in the bar instead — inventing filler
 * tabs to fill the track would make the control meaningless on the
 * screens where it does carry navigation.
 *
 * Labels index the `TopBar` namespace in messages/*.json.
 */
export const NAV_SECTIONS: Record<string, NavSection[]> = {
  "/agents": [
    { value: "team", labelKey: "agentsTeam", icon: Bot },
    { value: "working", labelKey: "agentsWorking2", icon: Activity },
    { value: "rondas", labelKey: "agentsRondas", icon: Repeat },
    { value: "approvals", labelKey: "agentsApprovals", icon: ShieldCheck },
    { value: "network", labelKey: "agentsNetwork", icon: Share2 },
    { value: "memory", labelKey: "agentsMemory", icon: Brain },
    // Key and model, the AI test and usage live together: testing is
    // what you do right after pasting a key. `?tab=playground` (old
    // links) still lands here, on the test.
    { value: "setup", labelKey: "agentsSettings", icon: Settings },
  ],
};
