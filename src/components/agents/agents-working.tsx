"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, CircleSlash, Loader2, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/dashboard/skeleton";
import { roleLabelKey } from "@/lib/agents/roles";
import { AgentFace } from "./agent-face";
import { compactAgo } from "./format";
import { BUSY, STATUS_TONE, statusLabelKey } from "./status";
import type {
  Agent,
  AgentStatus,
  AgentTask,
  AgentTaskStep,
} from "@/lib/agents/types";

interface AgentsWorkingProps {
  /** null renders the loading state. */
  agents: Agent[] | null;
  /** The task each agent is running, keyed by agent id. */
  currentByAgent: Record<string, AgentTask>;
  /** Lifetime replies per agent, for the footer stats. */
  handledByAgent: Record<string, number>;
  connected: boolean;
}

/**
 * The operation floor: every agent, what it is doing, and how long it
 * has been doing it.
 *
 * Distinct from the team screen, which is about configuration. This
 * one answers a different question — "is the operation running right
 * now?" — and so it is sorted by activity rather than by priority: the
 * agents doing something come first, the idle ones sink.
 */
export function AgentsWorking({
  agents,
  currentByAgent,
  handledByAgent,
  connected,
}: AgentsWorkingProps) {
  const t = useTranslations("Agents");
  const [openTask, setOpenTask] = useState<AgentTask | null>(null);

  if (agents === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-2xl" />
        ))}
      </div>
    );
  }

  // Busy first, then waiting, then the rest. Within a group, the one
  // that has been at it longest leads — that is the one most likely to
  // be stuck.
  const ordered = [...agents].sort((a, b) => {
    const rank = (s: AgentStatus) =>
      BUSY.includes(s) ? 0 : s === "waiting_approval" || s === "waiting_reply" ? 1 : s === "error" ? 2 : 3;
    const diff = rank(a.status) - rank(b.status);
    if (diff !== 0) return diff;
    return a.statusChangedAt.localeCompare(b.statusChangedAt);
  });

  return (
    <div className="space-y-4">
      <p
        className={cn(
          "flex items-center gap-2 text-xs",
          connected ? "text-muted-foreground" : "text-amber-400",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            connected ? "bg-primary" : "bg-amber-400",
          )}
          aria-hidden
        />
        {connected ? t("liveConnected") : t("liveOffline")}
      </p>

      {ordered.length === 0 ? (
        <div className="surface rounded-2xl px-6 py-16 text-center">
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {t("emptyBody")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((agent) => (
            <WorkingCard
              key={agent.id}
              agent={agent}
              task={currentByAgent[agent.id]}
              handled={handledByAgent[agent.id] ?? 0}
              onOpen={() => {
                const task = currentByAgent[agent.id];
                if (task) setOpenTask(task);
              }}
            />
          ))}
        </div>
      )}

      {openTask ? (
        <TaskDetail task={openTask} onClose={() => setOpenTask(null)} />
      ) : null}
    </div>
  );
}

function WorkingCard({
  agent,
  task,
  handled,
  onOpen,
}: {
  agent: Agent;
  task?: AgentTask;
  handled: number;
  onOpen: () => void;
}) {
  const t = useTranslations("Agents");
  const busy = BUSY.includes(agent.status);
  // Never build a translation key from a free-text column — see
  // `roleLabelKey`.
  const roleKey = roleLabelKey(agent.role);

  return (
    <article className="surface flex flex-col rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <AgentFace
          agent={agent}
          working={busy}
          className={cn(
            "size-11 shrink-0 bg-foreground/8",
            STATUS_TONE[agent.status],
          )}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-foreground">{agent.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {roleKey ? t(roleKey) : agent.department}
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs",
            STATUS_TONE[agent.status],
          )}
        >
          {busy ? (
            <span className="fx-blink flex items-center gap-0.5" aria-hidden>
              <span className="size-1 rounded-full bg-current" />
              <span className="size-1 rounded-full bg-current" />
              <span className="size-1 rounded-full bg-current" />
            </span>
          ) : null}
          {t(statusLabelKey(agent.status))}
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-foreground/5 p-3">
        <p className="eyebrow">{t("currentTask")}</p>
        {task ? (
          <>
            <p className="mt-1 truncate text-sm text-foreground">{task.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {task.startedAt
                ? t("elapsed", { time: compactAgo(task.startedAt) })
                : null}
              {task.attempts > 1
                ? ` · ${t("attemptsLabel", { n: task.attempts, max: task.maxAttempts })}`
                : ""}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {agent.statusDetail ?? t("noCurrentTask")}
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-muted-foreground">
        <span className="tabular-nums">{t("tasksDone", { count: handled })}</span>
        {task ? (
          <button
            type="button"
            onClick={onOpen}
            className="ml-auto text-primary underline-offset-4 hover:underline"
          >
            {t("openDetail")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

const STEP_ICON = {
  running: Loader2,
  done: CircleCheck,
  failed: TriangleAlert,
  skipped: CircleSlash,
} as const;

const STEP_TONE = {
  running: "text-primary",
  done: "text-primary",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
} as const;

/**
 * The execution trace for one task.
 *
 * Reads the steps the runner wrote — it does not animate a plausible
 * sequence. That distinction is the whole value: a panel that invents
 * "Etapa 3: analisando" would look identical whether the agent was
 * working or hung.
 */
function TaskDetail({ task, onClose }: { task: AgentTask; onClose: () => void }) {
  const t = useTranslations("Agents");
  const [steps, setSteps] = useState<AgentTaskStep[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/tasks/${task.id}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { steps: AgentTaskStep[] };
      setSteps(data.steps ?? []);
    } catch {
      setSteps([]);
    }
  }, [task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A running task keeps writing steps, so re-read while it is open.
  // Three seconds: slow enough to be cheap, fast enough that the panel
  // doesn't feel frozen while the agent works.
  useEffect(() => {
    if (task.status !== "running") return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [task.status, load]);

  return (
    <div className="surface rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{t("stepsTitle")}</p>
          <h3 className="mt-1 truncate font-medium text-foreground">
            {task.title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeDetail")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {steps === null ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-xl" />
          ))}
        </div>
      ) : steps.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("stepsEmpty")}</p>
      ) : (
        <ol className="mt-4 space-y-1">
          {steps.map((step) => {
            const Icon = STEP_ICON[step.status];
            return (
              <li
                key={step.id}
                className="flex items-start gap-3 rounded-xl px-2 py-2"
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    STEP_TONE[step.status],
                    step.status === "running" && "animate-spin",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{step.label}</p>
                  {step.detail ? (
                    <p className="text-xs text-muted-foreground">
                      {step.detail}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {compactAgo(step.startedAt)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
