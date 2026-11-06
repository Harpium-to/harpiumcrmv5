import {
  Activity,
  Bell,
  Bot,
  ChartColumn,
  GitBranch,
  LifeBuoy,
  LayoutDashboard,
  Magnet,
  MessageSquare,
  Plug,
  Radio,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

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

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /**
   * The rail draws a hairline between groups. Purely visual
   * rhythm — 12 identical icons in one column is a wall.
   *   work   — the day-to-day: inbox, contacts, pipelines
   *   build  — things you configure once and leave running
   *   system — settings
   */
  group: "work" | "build" | "system";
  /** Renders a small "Beta" chip in the drawer / tooltip. */
  beta?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, group: "work" },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare, group: "work" },
  { href: "/notifications", labelKey: "notifications", icon: Bell, group: "work" },
  { href: "/contacts", labelKey: "contacts", icon: Users, group: "work" },
  { href: "/leads", labelKey: "leads", icon: Magnet, group: "work" },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch, group: "work" },
  { href: "/relatorios", labelKey: "reports", icon: ChartColumn, group: "work" },
  { href: "/agents", labelKey: "aiAgents", icon: Bot, group: "build" },
  { href: "/automations", labelKey: "automations", icon: Zap, group: "build" },
  { href: "/flows", labelKey: "flows", icon: Workflow, group: "build", beta: true },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio, group: "build" },
  { href: "/canais", labelKey: "channels", icon: Plug, group: "build" },
  { href: "/settings", labelKey: "settings", icon: Settings, group: "system" },
  { href: "/ajuda", labelKey: "help", icon: LifeBuoy, group: "system" },
];

export const NAV_GROUPS: NavItem["group"][] = ["work", "build", "system"];

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
    { value: "network", labelKey: "agentsNetwork", icon: Share2 },
    { value: "approvals", labelKey: "agentsApprovals", icon: ShieldCheck },
    { value: "playground", labelKey: "agentsPlayground", icon: Sparkles },
    { value: "setup", labelKey: "agentsSetup", icon: Settings },
  ],
};
