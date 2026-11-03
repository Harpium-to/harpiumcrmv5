"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapAgentRunRow } from "@/lib/agents/store";
import type { AgentRun } from "@/lib/agents/types";

interface UseAgentActivityOptions {
  /** How many rows to backfill. */
  limit?: number;
  /**
   * Realtime channel name. Distinct per consumer: the top-bar chip and
   * the live feed both watch `agent_runs`, and two subscribers sharing
   * one channel name means the second one silently replaces the first.
   */
  channelName: string;
  /** Skip both the fetch and the subscription (e.g. panel not open). */
  enabled?: boolean;
}

interface AgentActivity {
  /** null while the backfill is in flight. */
  runs: AgentRun[] | null;
  /** How many agents are mid-reply right now. */
  running: number;
  /** Realtime socket state — the feed shows "reconnecting" when false. */
  connected: boolean;
  /** Ids that arrived over Realtime, so the UI can flash them once. */
  freshIds: Set<string>;
  refresh: () => void;
}

/** Keep the in-memory feed bounded; the monitor is a tail, not an archive. */
const MAX_ROWS = 200;

/**
 * The agent activity feed: one REST backfill, then Realtime.
 *
 * Polling was the obvious alternative and is the wrong one here. The
 * screen's whole claim is that you can watch the agents work, and a
 * five-second poll both misses the sub-second `running → replied`
 * transition (the part that reads as *working*) and keeps querying all
 * day for an account whose agents are idle.
 *
 * Realtime respects RLS, and `agent_runs` only lets members select
 * their own account's rows, so the subscription cannot leak another
 * tenant's traffic even though it is not filtered client-side.
 */
export function useAgentActivity({
  limit = 50,
  channelName,
  enabled = true,
}: UseAgentActivityOptions): AgentActivity {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // The backfill can land after a Realtime row has already been
  // prepended (a busy account, a slow request). Merging by id rather
  // than replacing keeps that row instead of dropping it for a page
  // that predates it.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    (async () => {
      try {
        const res = await fetch(`/api/agents/runs?limit=${limit}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { runs: AgentRun[] };
        if (!active) return;
        setRuns((prev) => mergeRuns(prev ?? [], data.runs ?? [], seen.current));
      } catch {
        // A failed backfill leaves an empty feed, not a broken screen —
        // Realtime still fills it as runs happen.
        if (active) setRuns((prev) => prev ?? []);
      }
    })();

    return () => {
      active = false;
    };
  }, [limit, enabled, nonce]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_runs" },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = mapAgentRunRow(
            payload.new as Parameters<typeof mapAgentRunRow>[0],
          );
          seen.current.add(row.id);
          setRuns((prev) => mergeRuns(prev ?? [], [row], seen.current));
          // Only an INSERT is "new work landing". An UPDATE is the same
          // run closing out, and flashing it a second time would make a
          // single handling look like two.
          if (payload.eventType === "INSERT") {
            setFreshIds((prev) => new Set(prev).add(row.id));
          }
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [channelName, enabled]);

  const running = (runs ?? []).filter((r) => r.status === "running").length;

  return { runs, running, connected, freshIds, refresh };
}

/**
 * Newest-first merge, de-duplicated by id so an updated run replaces
 * its own earlier state rather than appearing twice.
 */
function mergeRuns(
  current: AgentRun[],
  incoming: AgentRun[],
  seen: Set<string>,
): AgentRun[] {
  const byId = new Map(current.map((r) => [r.id, r]));
  for (const run of incoming) {
    byId.set(run.id, run);
    seen.add(run.id);
  }
  return [...byId.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_ROWS);
}
