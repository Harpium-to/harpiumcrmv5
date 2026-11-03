"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  CircleCheck,
  CircleSlash,
  Loader2,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/dashboard/skeleton";
import { compactAgo, formatDuration } from "./format";
import type { AgentRun, AgentRunStatus } from "@/lib/agents/types";

interface AgentLiveFeedProps {
  /** null renders the loading state. */
  runs: AgentRun[] | null;
  connected: boolean;
  /** Run ids that arrived over Realtime — flashed once on arrival. */
  freshIds: Set<string>;
}

/**
 * Status → how the row reads. `skipped` is intentionally the quietest
 * of the five: those rows exist to be findable when someone asks "why
 * didn't it answer", not to compete with the runs that did something.
 */
const STATUS_META: Record<
  AgentRunStatus,
  { icon: LucideIcon; labelKey: string; tone: string }
> = {
  running: { icon: Loader2, labelKey: "runRunning", tone: "text-primary" },
  replied: { icon: CircleCheck, labelKey: "runReplied", tone: "text-primary" },
  handoff: { icon: UserRound, labelKey: "runHandoff", tone: "text-amber-400" },
  skipped: {
    icon: CircleSlash,
    labelKey: "runSkipped",
    tone: "text-muted-foreground",
  },
  failed: {
    icon: TriangleAlert,
    labelKey: "runFailed",
    tone: "text-destructive",
  },
};

/**
 * The live monitor: every handling, newest first, as it happens.
 *
 * This is the screen that answers "are the agents actually working?" —
 * so it shows the declined runs too. A feed of successes only looks
 * healthy right up until the moment something is quietly wrong, and
 * that is exactly when someone opens it.
 */
export function AgentLiveFeed({
  runs,
  connected,
  freshIds,
}: AgentLiveFeedProps) {
  const t = useTranslations("Agents");

  if (runs === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="surface rounded-2xl p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3 w-full max-w-md" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

      {runs.length === 0 ? (
        <div className="surface rounded-2xl px-6 py-12 text-center">
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {t("liveEmpty")}
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} fresh={freshIds.has(run.id)} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RunRow({ run, fresh }: { run: AgentRun; fresh: boolean }) {
  const t = useTranslations("Agents");
  const meta = STATUS_META[run.status] ?? STATUS_META.skipped;
  const Icon = meta.icon;
  const duration = formatDuration(run.durationMs);

  return (
    <li
      className={cn(
        "surface rounded-2xl p-4",
        fresh && "fx-landed",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("flex items-center gap-1.5 text-sm", meta.tone)}>
          <Icon
            className={cn("size-4", run.status === "running" && "animate-spin")}
            aria-hidden
          />
          {t(meta.labelKey)}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {run.agentName}
        </span>
        {run.matchedKeyword ? (
          <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-xs text-muted-foreground">
            {run.matchedKeyword}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {compactAgo(run.startedAt)}
        </span>
      </div>

      {run.inboundPreview || run.outputPreview ? (
        <div className="mt-2.5 flex items-start gap-2 text-sm">
          {run.inboundPreview ? (
            <p className="min-w-0 flex-1 truncate text-muted-foreground">
              {run.inboundPreview}
            </p>
          ) : null}
          {run.outputPreview ? (
            <>
              <ArrowRight
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60"
                aria-hidden
              />
              <p className="min-w-0 flex-1 truncate text-foreground">
                {run.outputPreview}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {/* `reason` is the whole value of a skipped row — it is the
            answer to "why didn't it reply". */}
        {run.reason ? (
          <span className="font-mono opacity-80">{run.reason}</span>
        ) : null}
        {duration ? <span className="tabular-nums">{duration}</span> : null}
        {run.totalTokens ? (
          <span className="tabular-nums">
            {t("runTokens", { count: run.totalTokens })}
          </span>
        ) : null}
        {run.conversationId ? (
          <Link
            href={`/inbox?conversation=${run.conversationId}`}
            className="ml-auto text-primary underline-offset-4 hover:underline"
          >
            {t("openConversation")}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
