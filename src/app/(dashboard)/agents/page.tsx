"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { canEditSettings, hasMinRole } from "@/lib/auth/roles";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import type { Agent } from "@/lib/agents/types";
import type { AgentStats } from "@/lib/agents/store";

import { Button } from "@/components/ui/button";
import { DisplayHeading } from "@/components/ui/display-heading";
import { StatRing } from "@/components/ui/stat-ring";
import { FilterChips, type PillItem } from "@/components/ui/pill-nav";
import { Reveal } from "@/components/ui/reveal";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Skeleton } from "@/components/dashboard/skeleton";

import { AgentCard } from "@/components/agents/agent-card";
import { AgentForm } from "@/components/agents/agent-form";
import { AgentLiveFeed } from "@/components/agents/agent-live-feed";
import { AgentsWorking } from "@/components/agents/agents-working";
import { AgentNetwork } from "@/components/agents/agent-network";
import { AgentApprovals } from "@/components/agents/agent-approvals";
import { useAgentOperation } from "@/hooks/use-agent-operation";
import {
  AGENT_ICONS,
  FALLBACK_AGENT_ICON,
} from "@/components/agents/agent-icon";
import { AiPlayground } from "@/components/agents/ai-playground";
import { AiUsageCard } from "@/components/agents/ai-usage";
import { AiConfig } from "@/components/settings/ai-config";

type Tab =
  | "team"
  | "working"
  | "network"
  | "approvals"
  | "playground"
  | "setup";

const EMPTY_STATS: AgentStats = {
  handledToday: 0,
  handoffToday: 0,
  running: 0,
  handledByAgent: {},
  lastRunByAgent: {},
};

export default function AgentsPage() {
  // `useSearchParams` needs a boundary above it; the fallback mirrors
  // the real heading's height so the page doesn't jump when it
  // resolves.
  return (
    <Suspense fallback={<div className="h-40" />}>
      <AgentsPageInner />
    </Suspense>
  );
}

function AgentsPageInner() {
  const t = useTranslations("Agents");
  const params = useSearchParams();
  const { accountRole } = useAuth();
  // Two different gates. Configuring an agent is settings-class work
  // (admin+); deciding an approval is shift work, so anyone who
  // handles conversations can do it — which is what the API enforces
  // too. Using the admin gate here would have shown a read-only queue
  // to exactly the people meant to clear it.
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const canDecide = accountRole ? hasMinRole(accountRole, "agent") : false;

  const tabParam = params.get("tab");
  const tab: Tab =
    tabParam === "working" ||
    tabParam === "network" ||
    tabParam === "approvals" ||
    tabParam === "playground" ||
    tabParam === "setup"
      ? tabParam
      : "team";

  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [stats, setStats] = useState<AgentStats>(EMPTY_STATS);
  const [department, setDepartment] = useState("all");
  const [editing, setEditing] = useState<Agent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const { runs, running, connected, freshIds } = useAgentActivity({
    channelName: "agent-monitor",
  });
  // The work queue, for the operation floor. Subscribed only while
  // that section is open — every page in the app already carries the
  // top bar's run subscription, and a second always-on channel for a
  // board nobody is looking at is a socket for nothing.
  const {
    currentByAgent,
    connected: queueConnected,
  } = useAgentOperation({
    channelName: "agent-queue",
    enabled: tab === "working",
  });

  const loadTeam = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { agents: Agent[]; stats: AgentStats };
      setAgents(data.agents ?? []);
      setStats(data.stats ?? EMPTY_STATS);
    } catch {
      // A missing team reads as "no agents yet", which is also what a
      // brand-new workspace looks like — the empty state below is the
      // right thing to show either way.
      setAgents((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  // Which agents have a run open right now. Derived from the same
  // Realtime feed the monitor uses, so a card lights up the instant a
  // run opens rather than on the next refetch.
  const workingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of runs ?? []) {
      if (run.status === "running" && run.agentId) ids.add(run.agentId);
    }
    return ids;
  }, [runs]);

  const departments = useMemo(() => {
    const items: PillItem[] = [{ value: "all", label: t("filterAll") }];
    const seen = new Set<string>();
    for (const agent of agents ?? []) {
      if (seen.has(agent.department)) continue;
      seen.add(agent.department);
      items.push({
        value: agent.department,
        label: agent.department,
        icon: AGENT_ICONS[agent.department] ?? FALLBACK_AGENT_ICON,
      });
    }
    return items;
  }, [agents, t]);

  const visible = useMemo(
    () =>
      (agents ?? []).filter(
        (a) => department === "all" || a.department === department,
      ),
    [agents, department],
  );

  const activeCount = (agents ?? []).filter((a) => a.isActive).length;

  /**
   * Flip an agent on or off. Optimistic: the card is the switch, and a
   * switch that waits for a round trip before moving feels broken. On
   * failure the previous value is put back and the error surfaces.
   */
  async function toggle(agent: Agent, next: boolean) {
    setPendingId(agent.id);
    setAgents((prev) =>
      (prev ?? []).map((a) => (a.id === agent.id ? { ...a, isActive: next } : a)),
    );
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      setAgents((prev) =>
        (prev ?? []).map((a) => (a.id === agent.id ? (data.agent as Agent) : a)),
      );
    } catch (err) {
      setAgents((prev) =>
        (prev ?? []).map((a) =>
          a.id === agent.id ? { ...a, isActive: !next } : a,
        ),
      );
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setPendingId(null);
    }
  }

  /**
   * Copy an agent and open the copy.
   *
   * Opening it is the point: nobody duplicates an agent to have two
   * identical ones, and the server deliberately hands back a clone
   * that is switched off and is not the account default, so the form
   * is where the copy becomes something. Landing on the list instead
   * would leave an inert near-duplicate for the operator to find.
   */
  async function duplicate(agent: Agent) {
    if (duplicatingId) return;
    setDuplicatingId(agent.id);
    try {
      const res = await fetch(`/api/agents/${agent.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "erro");
      const copy = data.agent as Agent;
      setAgents((prev) => [...(prev ?? []), copy]);
      toast.success(t("duplicated"));
      setEditing(copy);
      setFormOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setDuplicatingId(null);
    }
  }

  function handleSaved(saved: Agent) {
    setAgents((prev) => {
      const list = prev ?? [];
      return list.some((a) => a.id === saved.id)
        ? list.map((a) => (a.id === saved.id ? saved : a))
        : [...list, saved];
    });
  }

  function handleDeleted(id: string) {
    setAgents((prev) => (prev ?? []).filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-8">
      <DisplayHeading title={t("title")} subtitle={t("titleLine2")}>
        {agents === null ? (
          <Skeleton className="size-[108px] rounded-full" />
        ) : (
          <StatRing
            value={activeCount}
            total={agents.length}
            label={t("ringLabel")}
          />
        )}
        <MetricCard title={t("statHandled")} value={stats.handledToday} />
        <MetricCard title={t("statHandoff")} value={stats.handoffToday} />
        {/* Taken from the live feed, not from the stats fetch: this is
            the number that has to be true *right now*. */}
        <MetricCard title={t("statRunning")} value={running} />
      </DisplayHeading>

      {tab === "team" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {departments.length > 1 ? (
              <FilterChips
                items={departments}
                value={department}
                onChange={setDepartment}
                ariaLabel={t("formDepartment")}
              />
            ) : (
              <p className="max-w-2xl text-sm text-muted-foreground">
                {t("subtitle")}
              </p>
            )}
            {canEdit ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus />
                {t("newAgent")}
              </Button>
            ) : null}
          </div>

          {agents === null ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-56 rounded-2xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="surface rounded-2xl px-6 py-16 text-center">
              <h2 className="text-lg font-medium text-foreground">
                {t("emptyTitle")}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {t("emptyBody")}
              </p>
              {canEdit ? (
                <Button
                  className="mt-6"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus />
                  {t("newAgent")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((agent, i) => (
                <Reveal key={agent.id} index={i}>
                  <AgentCard
                    agent={agent}
                    handled={stats.handledByAgent[agent.id] ?? 0}
                    lastRun={stats.lastRunByAgent[agent.id]}
                    working={workingIds.has(agent.id)}
                    canEdit={canEdit}
                    pending={pendingId === agent.id}
                    duplicating={duplicatingId === agent.id}
                    onToggle={(next) => void toggle(agent, next)}
                    onDuplicate={() => void duplicate(agent)}
                    onEdit={() => {
                      setEditing(agent);
                      setFormOpen(true);
                    }}
                  />
                </Reveal>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "working" ? (
        <div className="space-y-8">
          <AgentsWorking
            agents={agents}
            currentByAgent={currentByAgent}
            handledByAgent={stats.handledByAgent}
            connected={queueConnected}
          />
          {/* What just happened, under what is happening now. The two
              answer different questions and people read them in that
              order: who is busy, then what came of it. */}
          <AgentLiveFeed runs={runs} connected={connected} freshIds={freshIds} />
        </div>
      ) : null}

      {tab === "network" ? <AgentNetwork agents={agents} /> : null}

      {tab === "approvals" ? <AgentApprovals canDecide={canDecide} /> : null}

      {tab === "playground" ? <AiPlayground /> : null}

      {tab === "setup" ? (
        <div className="space-y-6">
          <AiConfig />
          {canEdit ? <AiUsageCard /> : null}
        </div>
      ) : null}

      <AgentForm
        open={formOpen}
        onOpenChange={setFormOpen}
        agent={editing}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
