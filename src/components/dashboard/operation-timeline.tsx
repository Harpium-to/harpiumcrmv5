"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useAgentOperation } from "@/hooks/use-agent-operation";
import type { AgentRun, AgentTask } from "@/lib/agents/types";

interface Entry {
  id: string;
  at: string;
  agentName: string;
  /** Already-translated line. */
  text: string;
  tone: string;
  href: string;
}

/**
 * The operation, minute by minute.
 *
 * One chronological line that merges two sources — tasks the agents
 * picked up, and replies they sent — because that is how the work
 * actually reads: the prospector finds a company at 10:42 and the SDR
 * messages the owner at 10:45, and seeing those in two separate panels
 * loses the thing that makes it legible, which is the sequence.
 *
 * Every row is a link. "Clicável para abrir detalhes" is not a nicety
 * here: a timeline you cannot drill into is decoration, and the first
 * question anyone has about a line is always "what exactly did it do".
 */
export function OperationTimeline({ limit = 12 }: { limit?: number }) {
  const t = useTranslations("Agents");
  const { runs } = useAgentActivity({
    limit: 30,
    channelName: "dashboard-timeline-runs",
  });
  const { tasks } = useAgentOperation({
    channelName: "dashboard-timeline-tasks",
    statuses: ["running", "done", "waiting_approval", "failed"],
    limit: 30,
  });

  const entries = useMemo(
    () => buildEntries(runs, tasks, t).slice(0, limit),
    [runs, tasks, t, limit],
  );

  const loading = runs === null && tasks === null;

  return (
    <section className="surface rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium text-foreground">{t("operationTitle")}</h2>
        <Link
          href="/agents?tab=working"
          className="flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("viewAll")}
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("operationEmpty")}
        </p>
      ) : (
        <ol className="mt-4 space-y-0.5">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={entry.href}
                className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-foreground/5"
              >
                <time
                  dateTime={entry.at}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {clock(entry.at)}
                </time>
                <span className={cn("size-1.5 shrink-0 rounded-full", entry.tone)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  <span className="font-medium">{entry.agentName}</span>{" "}
                  <span className="text-muted-foreground">{entry.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** HH:MM in the reader's own locale and zone — the line reads as a log. */
function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RUN_TEXT: Record<string, { key: string; tone: string }> = {
  running: { key: "runRunning", tone: "bg-primary" },
  replied: { key: "runReplied", tone: "bg-primary" },
  handoff: { key: "runHandoff", tone: "bg-amber-400" },
  skipped: { key: "runSkipped", tone: "bg-muted-foreground" },
  failed: { key: "runFailed", tone: "bg-destructive" },
};

const TASK_TEXT: Record<string, { key: string; tone: string }> = {
  running: { key: "taskRunning", tone: "bg-primary" },
  done: { key: "taskDone", tone: "bg-primary" },
  waiting_approval: { key: "taskWaitingApproval", tone: "bg-amber-400" },
  failed: { key: "taskFailed", tone: "bg-destructive" },
};

function buildEntries(
  runs: AgentRun[] | null,
  tasks: AgentTask[] | null,
  t: (key: string) => string,
): Entry[] {
  const entries: Entry[] = [];

  for (const run of runs ?? []) {
    const meta = RUN_TEXT[run.status];
    if (!meta) continue;
    entries.push({
      id: `run:${run.id}`,
      at: run.startedAt,
      agentName: run.agentName,
      text: run.outputPreview
        ? `${t(meta.key)} — ${run.outputPreview}`
        : t(meta.key),
      tone: meta.tone,
      href: run.conversationId
        ? `/inbox?conversation=${run.conversationId}`
        : "/agents?tab=working",
    });
  }

  for (const task of tasks ?? []) {
    const meta = TASK_TEXT[task.status];
    if (!meta) continue;
    entries.push({
      id: `task:${task.id}`,
      // A finished task belongs at the moment it finished; an open one
      // at the moment it started. Sorting a done task by its start time
      // would file it above work that actually happened after it.
      at: task.finishedAt ?? task.startedAt ?? task.createdAt,
      // The queue carries no agent name, only an id. The task title is
      // the useful half of the line anyway.
      agentName: task.title,
      text: t(meta.key),
      tone: meta.tone,
      href: "/agents?tab=working",
    });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
