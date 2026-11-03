"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapTaskRow } from "@/lib/agents/tasks";
import type { AgentTask, AgentTaskStatus } from "@/lib/agents/types";

/** The statuses the operation board cares about — work still in play. */
const OPEN_STATUSES: AgentTaskStatus[] = [
  "queued",
  "blocked",
  "running",
  "waiting_approval",
];

interface UseAgentOperationOptions {
  channelName: string;
  /** Include finished work. The board wants open tasks; the queue view wants all. */
  statuses?: AgentTaskStatus[];
  limit?: number;
  enabled?: boolean;
}

interface AgentOperation {
  /** null while the backfill is in flight. */
  tasks: AgentTask[] | null;
  /** The task each agent is running right now, keyed by agent id. */
  currentByAgent: Record<string, AgentTask>;
  connected: boolean;
  refresh: () => void;
}

/**
 * The live operation: what every agent is doing, right now.
 *
 * One REST backfill then Realtime, same shape as `useAgentActivity`.
 * Polling is the wrong tool for the same reason: a task can go
 * queued → running → done inside a second, and the running moment is
 * precisely the one the board exists to show.
 *
 * Realtime respects RLS and `agent_tasks` only lets members select
 * their own account's rows, so the subscription cannot leak another
 * tenant's queue even though it carries no client-side filter.
 */
export function useAgentOperation({
  channelName,
  statuses = OPEN_STATUSES,
  limit = 100,
  enabled = true,
}: UseAgentOperationOptions): AgentOperation {
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const statusKey = statuses.join(",");

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    (async () => {
      try {
        const res = await fetch(
          `/api/agents/tasks?status=${encodeURIComponent(statusKey)}&limit=${limit}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { tasks: AgentTask[] };
        if (!active) return;
        setTasks((prev) => merge(prev ?? [], data.tasks ?? []));
      } catch {
        // A failed backfill leaves an empty board, not a broken one —
        // Realtime still fills it as work happens.
        if (active) setTasks((prev) => prev ?? []);
      }
    })();

    return () => {
      active = false;
    };
  }, [statusKey, limit, enabled, nonce]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_tasks" },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const task = mapTaskRow(
            payload.new as Parameters<typeof mapTaskRow>[0],
          );
          setTasks((prev) => merge(prev ?? [], [task]));
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [channelName, enabled]);

  // One running task per agent. If an agent somehow has two (a retry
  // racing a claim), the newest wins — it is the one whose steps are
  // currently being written.
  const currentByAgent = useMemo(() => {
    const map: Record<string, AgentTask> = {};
    for (const task of tasks ?? []) {
      if (task.status !== "running" || !task.agentId) continue;
      const held = map[task.agentId];
      if (!held || task.startedAt! > held.startedAt!) map[task.agentId] = task;
    }
    return map;
  }, [tasks]);

  return { tasks, currentByAgent, connected, refresh };
}

/** Newest-first merge, de-duplicated by id. */
function merge(current: AgentTask[], incoming: AgentTask[]): AgentTask[] {
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const task of incoming) byId.set(task.id, task);
  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 300);
}
