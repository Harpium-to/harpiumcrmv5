"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CornerDownRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/dashboard/skeleton";
import { buildAgentNetwork, type NetworkSlot } from "@/lib/agents/network";
import { roleLabelKey } from "@/lib/agents/roles";
import { AgentFace } from "./agent-face";
import { BUSY, STATUS_TONE, statusLabelKey } from "./status";
import type { Agent } from "@/lib/agents/types";

interface AgentNetworkProps {
  /** null renders the loading state. */
  agents: Agent[] | null;
}

/**
 * The commercial line, as a graph.
 *
 * The team screen answers "who do I have". This answers a question no
 * list can: "where does the work stop". Every post in the handoff
 * chain gets a station whether or not anybody fills it, because an
 * empty station is the finding — a prospector feeding a researcher
 * that doesn't exist is a queue filling up with tasks nothing will
 * ever claim, and that is invisible on a screen that only draws the
 * agents you created.
 *
 * The edges are not inferred from traffic; they are `HANDOFF_CHAIN`,
 * the same table the runner reads when it decides where a finished
 * task goes next. So this picture cannot drift from the behaviour —
 * if it shows SDR → Executivo, that is literally what will happen.
 *
 * Each station names its own successor rather than having an arrow
 * drawn to it. Follow-up feeds the executive directly, skipping two
 * stations, and a line drawn across the columns would either lie about
 * the geometry or need absolute positioning that breaks the moment the
 * layout wraps on a phone.
 */
export function AgentNetwork({ agents }: AgentNetworkProps) {
  const t = useTranslations("Agents");
  const net = useMemo(() => buildAgentNetwork(agents ?? []), [agents]);

  if (agents === null) {
    return (
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 min-w-52 flex-1 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-foreground">
          {net.uncovered === 0
            ? t("networkComplete")
            : t("networkUncovered", { count: net.uncovered })}
        </p>
        <p className="text-sm text-muted-foreground">{t("networkHint")}</p>
      </div>

      {/* Scrolls sideways rather than wrapping: the left-to-right
          reading *is* the handoff order, and a column that wraps to
          the next line reads as a step backwards. */}
      <div className="-mx-1 flex items-stretch gap-2 overflow-x-auto px-1 pb-2">
        {net.lanes.map((slots, lane) => (
          <div key={lane} className="flex items-stretch gap-2">
            <div className="flex min-w-52 flex-col gap-2">
              {slots.map((slot) => (
                <SlotCard key={slot.role} slot={slot} />
              ))}
            </div>
            {lane < net.lanes.length - 1 ? (
              <div
                className="flex shrink-0 items-center text-muted-foreground/40"
                aria-hidden
              >
                <ArrowRight className="size-4" />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {net.loose.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="eyebrow">{t("networkLoose")}</p>
            <p className="text-xs text-muted-foreground">
              {t("networkLooseHint")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {net.loose.map((agent) => (
              <div key={agent.id} className="surface rounded-2xl p-3">
                <AgentRow agent={agent} />
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {roleLabelKey(agent.role)
                    ? t(roleLabelKey(agent.role)!)
                    : agent.department}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SlotCard({ slot }: { slot: NetworkSlot }) {
  const t = useTranslations("Agents");
  const label = slot.labelKey ? t(slot.labelKey) : slot.role;
  const staffed = slot.agents.length > 0;
  const live = slot.agents.some((a) => a.isActive);

  return (
    <article
      className={cn(
        "flex flex-1 flex-col rounded-2xl p-3",
        // A station nobody runs is drawn as an outline, not a card:
        // it is a hole in the operation, and it should look like one.
        staffed ? "surface" : "border border-dashed border-border/60",
      )}
    >
      <h3
        className={cn(
          "truncate text-sm font-medium",
          live ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </h3>

      {staffed ? (
        <ul className="mt-2.5 space-y-2">
          {slot.agents.map((agent) => (
            <li key={agent.id}>
              <AgentRow agent={agent} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-xs text-muted-foreground/70">
          {t("networkEmptySlot")}
        </p>
      )}

      <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground/70">
        {slot.next ? (
          <>
            <CornerDownRight className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {slot.nextLabelKey ? t(slot.nextLabelKey) : slot.next}
            </span>
          </>
        ) : (
          <span className="truncate">{t("networkEnds")}</span>
        )}
      </p>
    </article>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const t = useTranslations("Agents");
  const busy = BUSY.includes(agent.status);

  return (
    <div className={cn("flex items-center gap-2", !agent.isActive && "opacity-55")}>
      <AgentFace
        agent={agent}
        working={busy}
        className="size-7 shrink-0 bg-foreground/8 text-muted-foreground"
        iconClassName="size-3.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">
          {agent.name}
        </span>
        <span
          className={cn(
            "block truncate text-[0.7rem]",
            agent.isActive ? STATUS_TONE[agent.status] : "text-muted-foreground",
          )}
        >
          {agent.isActive ? t(statusLabelKey(agent.status)) : t("networkOff")}
        </span>
      </span>
    </div>
  );
}
