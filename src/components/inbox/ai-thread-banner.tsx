"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Hand, Undo2, Loader2, TriangleAlert, X } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { formatWait, waitInfo } from "@/lib/inbox/handoff-wait";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { parseReplyFailure, type ParsedReplyFailure } from "@/lib/ai/reply-failure";
import { autoReplyStatusFromConfig, type AiConfigSnapshot } from "@/lib/ai/autoreply-status";
import { createAiConfigSnapshotCache } from "@/lib/ai/config-snapshot-cache";
import type { AgentRunStatus } from "@/lib/agents/types";

// ------------------------------------------------------------
// The account's AI config is the same for every conversation, so the
// threads share one short-lived copy per account (see
// `config-snapshot-cache`: reused while fresh, read again after, so
// turning the agent on or off reaches an inbox that is already open).
// What it means for a given thread depends on that thread's channel,
// so the status itself is derived per thread from the snapshot.
// ------------------------------------------------------------
// `agentMode` (an active agent speaks on this thread's channel) matters
// twice: it turns the banner on even with the single-assistant switch
// off — the dispatcher never reads that switch in agent mode — and it
// is what makes `agent_runs` exist for the failure notice to read.
const aiConfigSnapshots = createAiConfigSnapshotCache({
  load: async () => {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    return res.ok ? ((await res.json()) as AiConfigSnapshot) : null;
  },
});

// ------------------------------------------------------------
// The last thing the bot did on this thread, from `agent_runs`.
//
// Skipped runs are ignored: they are the bot standing down (a human
// owns the thread, it is already paused), and letting one count as
// "latest" would wipe the failure notice or the cap title the moment
// the customer writes again. A newer reply, handoff or failure — or a
// run in flight — does supersede it.
// ------------------------------------------------------------
interface LatestRun {
  id: string;
  status: AgentRunStatus;
  reason: string | null;
  startedAt: number;
}

interface RunRow {
  id: string;
  status: string;
  reason: string | null;
  started_at: string;
}

function toLatestRun(row: RunRow): LatestRun {
  return {
    id: row.id,
    status: row.status as AgentRunStatus,
    reason: row.reason,
    startedAt: Date.parse(row.started_at) || 0,
  };
}

function useLatestAgentRun(conversationId: string, enabled: boolean): LatestRun | null {
  // Keyed by conversation so a thread switch never shows the previous
  // thread's run while the new one loads.
  const [state, setState] = useState<{ conversationId: string; run: LatestRun } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const supabase = createClient();

    const take = (row: RunRow) => {
      if (!alive || row.status === "skipped") return;
      const next = toLatestRun(row);
      setState((prev) => {
        const cur = prev?.conversationId === conversationId ? prev.run : null;
        if (cur && cur.id !== next.id && next.startedAt < cur.startedAt) return prev;
        return { conversationId, run: next };
      });
    };

    // RLS limits `agent_runs` to the caller's account; the filter
    // narrows it to this thread.
    supabase
      .from("agent_runs")
      .select("id, status, reason, started_at")
      .eq("conversation_id", conversationId)
      .neq("status", "skipped")
      .order("started_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const row = (data as RunRow[] | null)?.[0];
        if (row) take(row);
      });

    const channel = supabase
      .channel(`ai-banner-runs:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_runs",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          take(payload.new as RunRow);
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, enabled]);

  return enabled && state?.conversationId === conversationId ? state.run : null;
}

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
  /** `conversations.needs_human_since` (058) — handed off and nobody
   *  has answered the customer yet. */
  needsHumanSince?: string | null;
  /** `conversations.channel` — which agents may answer depends on it.
   *  Absent before migration 047, which means WhatsApp. */
  channel?: string | null;
  /** Current assignee; when a human owns the thread the bot won't run,
   *  so the "AI active" banner is suppressed. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" assigns the thread to them. */
  currentUserId?: string | null;
  /** Called after a successful toggle so the parent can patch its local
   *  conversation state (the realtime UPDATE also arrives, but this keeps
   *  the banner instant). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Inbox banner that surfaces + controls the AI auto-reply bot per
 * conversation:
 *   - bot active here → "AI is replying automatically" + [Take over]
 *   - bot paused here → the handoff note (if any) + [Resume AI]; when
 *     the pause came from the reply cap, the title says so
 *   - the bot's last attempt failed (agent mode) → a notice that the
 *     customer got no reply, why, and what to do — above either one
 * Renders nothing when no auto-reply runs on this thread (no active
 * agent speaks on its channel and the single-assistant switch is off),
 * or when the bot is active but a human already owns the thread
 * (nothing to do).
 */
export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  needsHumanSince,
  channel,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  const { accountId } = useAuth();
  const now = useNow(30_000);
  const wait = waitInfo(needsHumanSince, now);
  const [config, setConfig] = useState<AiConfigSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic local mirror of the pause flag so the banner flips
  // instantly on click; re-seeds whenever the thread (or its server
  // state via realtime) changes.
  const [paused, setPaused] = useState(disabled);
  useEffect(() => setPaused(disabled), [conversationId, disabled]);
  // The failure notice the operator closed, by run id — a new failure
  // is a new run and shows again.
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);

  // Asked on every thread opened and whenever the tab comes back into
  // view; the shared copy answers from memory while it is fresh. The
  // banner keeps showing the previous answer until a new one arrives.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const load = () =>
      aiConfigSnapshots.get(accountId).then((c) => alive && setConfig(c));
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [accountId, conversationId]);

  // Same rule as the dispatcher, for this thread's channel. Still
  // loading (null) → off.
  const status = autoReplyStatusFromConfig(config, channel);
  const latestRun = useLatestAgentRun(conversationId, status.agentMode);

  const toggle = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // "Take over" also assigns the thread to the acting agent.
          body: JSON.stringify({ paused, assign_to_me: paused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t("updateError"));
          return;
        }
        setPaused(paused);
        onChange?.({
          ai_autoreply_disabled: paused,
          // Take over assigns to the acting agent; resume releases only
          // the caller's own assignment. The realtime UPDATE reconciles
          // the exact value either way.
          ...(paused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(paused ? t("tookOver") : t("resumed"));
      } catch {
        toast.error(t("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t],
  );

  // Handed off and nobody answered yet: the loudest state, shown even
  // if the AI was switched off for the account since the handoff.
  if (wait.waiting && paused) {
    const mine = !!assignedAgentId && assignedAgentId === currentUserId;
    const title = mine
      ? t("waiting.mineTitle")
      : assignedAgentId
        ? t("waiting.assignedTitle")
        : t("waiting.nobodyTitle");
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col gap-2 border-y px-3 py-3 text-sm sm:flex-row sm:items-center sm:px-4",
          wait.late
            ? "border-red-700/40 bg-red-600 text-white"
            : "border-amber-500/50 bg-amber-400 text-amber-950",
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-black/10">
            {wait.late && (
              <span className="absolute inset-0 animate-ping rounded-full bg-white/40" aria-hidden />
            )}
            <Hand className="relative size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{title}</p>
            <p className="text-xs opacity-90">
              {wait.minutes < 1
                ? t("waiting.justNow")
                : t("waiting.since", { time: formatWait(wait.minutes) })}
              {wait.late ? ` · ${t("waiting.late")}` : ""}
            </p>
            {handoffSummary && (
              <p className="mt-1 line-clamp-2 text-xs opacity-90" title={handoffSummary}>
                {handoffSummary}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">
          {!mine && (
            <button
              type="button"
              onClick={() => toggle(true)}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-60",
                wait.late
                  ? "bg-white text-red-700 hover:bg-red-50"
                  : "bg-amber-950 text-amber-50 hover:bg-amber-900",
              )}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hand className="h-3.5 w-3.5" />}
              {t("waiting.takeOver")}
            </button>
          )}
          <button
            type="button"
            onClick={() => toggle(false)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-current/30 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-black/10 disabled:opacity-60"
          >
            <Undo2 className="h-3 w-3" />
            {t("resume")}
          </button>
        </div>
      </div>
    );
  }

  // Account has no auto-reply → nothing to show. (Still loading → nothing.)
  if (!status.autoReplyOn) return null;

  const failure: (ParsedReplyFailure & { runId: string }) | null =
    latestRun?.status === "failed" && latestRun.id !== dismissedRunId
      ? { ...parseReplyFailure(latestRun.reason), runId: latestRun.id }
      : null;

  const failureNotice = failure ? (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs sm:px-4"
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground">{t("failure.title")}</p>
        <p className="text-muted-foreground">{t(`failure.${failure.code}`)}</p>
        {failure.detail && (
          <p
            className="truncate font-mono text-[11px] text-muted-foreground/80"
            title={failure.detail}
          >
            {t("failure.detail", { detail: failure.detail })}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissedRunId(failure.runId)}
        aria-label={t("failure.dismiss")}
        title={t("failure.dismiss")}
        className="flex-shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  // Paused here (a human took over, or the bot handed off).
  if (paused) {
    const capReached =
      latestRun?.status === "handoff" && latestRun.reason === "reply_cap_reached";
    return (
      <>
        {failureNotice}
        <Banner tone="muted">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {capReached ? t("capPausedTitle") : t("pausedTitle")}
            </p>
            {handoffSummary && (
              <p className="truncate text-muted-foreground" title={handoffSummary}>
                {handoffSummary}
              </p>
            )}
          </div>
          <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
            {t("resume")}
          </BannerButton>
        </Banner>
      </>
    );
  }

  // Active, but a human already owns it → the bot won't fire; only a
  // pending failure is still worth showing.
  if (assignedAgentId) return failureNotice;

  // Active on this thread.
  return (
    <>
      {failureNotice}
      <Banner tone="primary">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground">
            {t("activeText")}
          </span>
        </div>
        <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
          {t("takeOver")}
        </BannerButton>
      </Banner>
    </>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
