"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { AtSign, ChevronDown, Hand, Search, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { initials as initialsOf, useMembers, useTeams } from "@/hooks/use-atendimento";
import { useNow } from "@/hooks/use-now";
import {
  formatWait,
  waitInfo,
  waitingFirst,
  type WaitInfo,
} from "@/lib/inbox/handoff-wait";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter =
  | ConversationStatus
  | "all"
  | "unread"
  | "waiting"
  | "mine"
  | "unassigned"
  | "myteams";

const FILTER_STORAGE_KEY = "harpium.inbox.filter";
const TEAM_STORAGE_KEY = "harpium.inbox.team";

function readStored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// The saved choice is read after hydration (the server has no storage):
// useSyncExternalStore renders the server snapshot (null) first, so the
// first paint matches the server's, then the saved filter.
const noSubscribe = () => () => {};

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private window / blocked storage: the filter just isn't remembered
  }
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  
  const { user } = useAuth();
  // Keeps "esperando há N min" counting between realtime events.
  const now = useNow(30_000);

  const { members } = useMembers();
  const { teams } = useTeams();
  const userId = user?.id ?? null;
  const myTeamIds = useMemo(
    () =>
      userId
        ? teams.filter((tm) => tm.active && tm.members.includes(userId)).map((tm) => tm.id)
        : [],
    [teams, userId],
  );
  const activeTeams = useMemo(() => teams.filter((tm) => tm.active), [teams]);

  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterMine"), value: "mine" },
    { label: t("filterUnassigned"), value: "unassigned" },
    ...(myTeamIds.length > 0 ? [{ label: t("filterMyTeams"), value: "myteams" as const }] : []),
    { label: t("filterWaiting"), value: "waiting" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t, myTeamIds.length]);

  const [search, setSearch] = useState("");
  // The last filter and setor each person used, remembered on this device.
  const storedFilter = useSyncExternalStore(
    noSubscribe,
    () => readStored(FILTER_STORAGE_KEY),
    () => null,
  );
  const storedTeam = useSyncExternalStore(
    noSubscribe,
    () => readStored(TEAM_STORAGE_KEY),
    () => null,
  );
  const [chosenFilter, setChosenFilter] = useState<InboxFilter | null>(null);
  const [chosenTeam, setChosenTeam] = useState<string | null | undefined>(undefined);
  const wanted = chosenFilter ?? (storedFilter as InboxFilter | null) ?? "all";
  // A saved filter that no longer applies (out of every setor) shows everything.
  const filter: InboxFilter =
    FILTER_OPTIONS.some((o) => o.value === wanted) ? wanted : "all";
  const teamFilter = chosenTeam === undefined ? storedTeam : chosenTeam;
  const setFilter = useCallback((next: InboxFilter) => {
    setChosenFilter(next);
    writeStored(FILTER_STORAGE_KEY, next);
  }, []);
  const setTeamFilter = useCallback((next: string | null) => {
    setChosenTeam(next);
    writeStored(TEAM_STORAGE_KEY, next);
  }, []);
  const [loading, setLoading] = useState(true);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const matchesFilter = useCallback(
    (c: Conversation, f: InboxFilter): boolean => {
      switch (f) {
        case "all":
          return true;
        case "unread":
          return c.unread_count > 0;
        case "waiting":
          return !!c.needs_human_since;
        case "mine":
          return !!userId && c.assigned_agent_id === userId && c.status !== "closed";
        case "unassigned":
          return !c.assigned_agent_id && c.status !== "closed";
        case "myteams":
          return (
            !c.assigned_agent_id &&
            c.status !== "closed" &&
            !!c.team_id &&
            myTeamIds.includes(c.team_id)
          );
        default:
          return c.status === f;
      }
    },
    [userId, myTeamIds],
  );

  // How many each filter holds, for the counters next to them.
  const filterCounts = useMemo(() => {
    const counts: Partial<Record<InboxFilter, number>> = {};
    for (const opt of ["mine", "unassigned", "myteams", "waiting"] as InboxFilter[]) {
      counts[opt] = conversations.filter((c) => matchesFilter(c, opt)).length;
    }
    return counts;
  }, [conversations, matchesFilter]);

  const filtered = useMemo(() => {
    let result = conversations.filter((c) => matchesFilter(c, filter));

    // A setor picked in the "Setor" menu (and still existing).
    if (teamFilter && activeTeams.some((tm) => tm.id === teamFilter)) {
      result = result.filter((c) => c.team_id === teamFilter);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    // Someone has to answer these: always on top, longest wait first.
    return waitingFirst(result);
  }, [conversations, filter, matchesFilter, teamFilter, activeTeams, search, selectedTagIds, selectedCompany]);

  const memberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const member of members) m.set(member.user_id, member.full_name || member.email || "");
    return m;
  }, [members]);
  const teamById = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);

  const waitingSummary = useMemo(() => {
    let count = 0;
    let late = 0;
    for (const c of conversations) {
      const w = waitInfo(c.needs_human_since, now);
      if (!w.waiting) continue;
      count++;
      if (w.late) late++;
    }
    return { count, late };
  }, [conversations, now]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  <span className="flex-1">{opt.label}</span>
                  {filterCounts[opt.value] !== undefined && (
                    <span className="ml-3 text-[11px] tabular-nums text-muted-foreground">
                      {filterCounts[opt.value]}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeTeams.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  teamFilter && teamById.has(teamFilter)
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {teamFilter && teamById.get(teamFilter) ? (
                  <>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: teamById.get(teamFilter)!.color }}
                    />
                    <span className="max-w-[7rem] truncate">{teamById.get(teamFilter)!.name}</span>
                  </>
                ) : (
                  t("team")
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 w-56 border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setTeamFilter(null)}
                  className={cn("text-sm", !teamFilter ? "text-primary" : "text-popover-foreground")}
                >
                  {t("allTeams")}
                </DropdownMenuItem>
                {activeTeams.map((tm) => (
                  <DropdownMenuItem
                    key={tm.id}
                    onClick={() => setTeamFilter(tm.id)}
                    className={cn("text-sm", teamFilter === tm.id ? "text-primary" : "text-popover-foreground")}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tm.color }} />
                      <span className="truncate">{tm.name}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}

        {/* Conversations the AI handed off with no answer yet. One
            click narrows the list to them; again to see everything. */}
        {waitingSummary.count > 0 && (
          <button
            type="button"
            onClick={() => setFilter(filter === "waiting" ? "all" : "waiting")}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors",
              waitingSummary.late > 0
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-amber-400 text-amber-950 hover:bg-amber-300",
            )}
          >
            <Hand className={cn("h-3.5 w-3.5 shrink-0", waitingSummary.late > 0 && "animate-pulse")} />
            <span className="min-w-0 flex-1">
              {t("waitingStrip", { count: waitingSummary.count })}
              {waitingSummary.late > 0 && ` · ${t("waitingLate", { count: waitingSummary.late })}`}
            </span>
            <span className="shrink-0 font-medium underline-offset-2 hover:underline">
              {filter === "waiting" ? t("waitingShowAll") : t("waitingShow")}
            </span>
          </button>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                wait={waitInfo(conv.needs_human_since, now)}
                currentUserId={user?.id ?? null}
                ownerName={
                  conv.assigned_agent_id ? memberName.get(conv.assigned_agent_id) ?? null : null
                }
                team={conv.team_id ? teamById.get(conv.team_id) ?? null : null}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  wait: WaitInfo;
  currentUserId: string | null;
  /** Who has it, for the initials chip. */
  ownerName?: string | null;
  /** The setor it is in, for the colour chip. */
  team?: { name: string; color: string } | null;
}

export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  wait,
  currentUserId,
  ownerName,
  team,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: ptBR,
      })
    : "";

  const owner = conversation.assigned_agent_id;
  const waitLabel = !wait.waiting
    ? null
    : owner && owner === currentUserId
      ? t("waitingMine")
      : owner
        ? t("waitingAssigned")
        : t("waitingNobody");

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        wait.waiting &&
          (wait.late
            ? "border-l-4 border-red-600 bg-red-500/10 hover:bg-red-500/15"
            : "border-l-4 border-amber-400 bg-amber-400/10 hover:bg-amber-400/15"),
        isActive && !wait.waiting && "border-l-2 border-primary bg-muted/70",
        isActive && wait.waiting && "ring-1 ring-inset ring-foreground/15",
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {/* Which door this thread uses. Only drawn for Instagram:
                WhatsApp is the overwhelming majority here, so badging
                every row would be noise, and the one that needs
                calling out is the exception. Absent entirely until
                migration 047 adds the column. */}
            {conversation.channel === "instagram" ? (
              <AtSign
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="Instagram"
              />
            ) : null}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {team && (
              <span
                className="inline-flex max-w-[5.5rem] items-center gap-1 rounded-full border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground"
                title={team.name}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
                <span className="truncate">{team.name}</span>
              </span>
            )}
            {owner && (
              <span
                className={cn(
                  "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold",
                  owner === currentUserId
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
                title={owner === currentUserId ? "Com você" : ownerName ? `Com ${ownerName}` : "Atribuída"}
              >
                {owner === currentUserId ? "eu" : initialsOf(ownerName)}
              </span>
            )}
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
        {waitLabel && (
          <span
            className={cn(
              "mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              wait.late ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950",
            )}
          >
            <Hand className={cn("h-3 w-3 shrink-0", wait.late && "animate-pulse")} />
            <span className="truncate">
              {waitLabel} · {formatWait(wait.minutes)}
            </span>
          </span>
        )}
      </div>
    </button>
  );
}
