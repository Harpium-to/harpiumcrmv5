"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { hasMinRole } from "@/lib/auth/roles";
import { formatCurrency, formatCompactNumber } from "@/lib/currency";
import { PERIOD_IDS, type PeriodId } from "@/lib/reports/range";
import type { ReportBundle } from "@/lib/reports/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DisplayHeading } from "@/components/ui/display-heading";
import { FilterChips, type PillItem } from "@/components/ui/pill-nav";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/dashboard/skeleton";

import { CategoryBars } from "@/components/reports/category-bars";
import { DayBars } from "@/components/reports/day-bars";
import { GoalMeters } from "@/components/reports/goal-meters";
import { ReportCard } from "@/components/reports/report-card";
import { AnalystPanel } from "@/components/reports/analyst-panel";

const PERIOD_CHOICES: PeriodId[] = [
  "today",
  "last7",
  "last30",
  "this_month",
  "last_month",
  "last90",
  "custom",
];

/** `YYYY-MM-DD` in the viewer's own zone — never via toISOString(),
 *  which is UTC and lands on yesterday for most of the day here. */
function todayKey(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <ReportsPageInner />
    </Suspense>
  );
}

function ReportsPageInner() {
  const t = useTranslations("Reports");
  const ta = useTranslations("Agents");
  const router = useRouter();
  const params = useSearchParams();
  const { accountRole } = useAuth();
  // Reading the numbers is for everyone on the account. Asking the
  // analyst spends the account's provider credit, so that follows the
  // same gate as the rest of the AI features.
  const canAsk = accountRole ? hasMinRole(accountRole, "agent") : false;

  const raw = params.get("period");
  const period: PeriodId = (PERIOD_IDS as string[]).includes(raw ?? "")
    ? (raw as PeriodId)
    : "last30";

  const [bundle, setBundle] = useState<ReportBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Custom bounds live in the URL alongside the period, so a link to
  // "1 a 15 de maio" reopens on the same window for whoever gets it.
  const customFrom = params.get("from") ?? "";
  const customTo = params.get("to") ?? "";

  // The window is resolved in the viewer's zone: the account has no
  // timezone of its own, and "hoje" has to mean the day the person
  // reading is having.
  const query = useMemo(() => {
    const zone =
      typeof Intl === "undefined"
        ? "America/Sao_Paulo"
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const search = new URLSearchParams({ period, tz: zone });
    if (period === "custom" && customFrom && customTo) {
      search.set("from", customFrom);
      search.set("to", customTo);
    }
    return search.toString();
  }, [period, customFrom, customTo]);

  const load = useCallback(async () => {
    setBundle(null);
    setError(null);
    try {
      const res = await fetch(`/api/reports?${query}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? t("loadFailed"));
      setBundle(data as ReportBundle);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function setPeriod(next: string) {
    const search = new URLSearchParams(params.toString());
    search.set("period", next);
    if (next === "custom" && !(customFrom && customTo)) {
      // Open the picker on something real rather than two empty boxes
      // that render an unusable report until both are filled.
      const today = todayKey();
      search.set("from", customFrom || today);
      search.set("to", customTo || today);
    }
    if (next !== "custom") {
      search.delete("from");
      search.delete("to");
    }
    router.replace(`/relatorios?${search.toString()}`);
  }

  function setBound(which: "from" | "to", value: string) {
    const search = new URLSearchParams(params.toString());
    search.set("period", "custom");
    search.set(which, value);
    // The other end always has a value, so a half-set range never
    // reaches the API — the resolver would quietly fall back to 30
    // days and the chips would disagree with the chart.
    const other = which === "from" ? "to" : "from";
    if (!search.get(other)) search.set(other, value);
    router.replace(`/relatorios?${search.toString()}`);
  }

  const chips: PillItem[] = PERIOD_CHOICES.map((id) => ({
    value: id,
    label: t(`period_${id}`),
  }));

  const currency = bundle?.currency ?? "BRL";
  const money = (value: number) => formatCurrency(value, currency);

  return (
    <div className="space-y-8">
      <DisplayHeading title={t("title")} subtitle={t("titleLine2")}>
        {bundle === null ? (
          <>
            <Skeleton className="h-16 w-32" />
            <Skeleton className="h-16 w-24" />
          </>
        ) : (
          <>
            <MetricCard
              title={t("statRevenue")}
              value={bundle.deals.wonValue.current}
              format={money}
              delta={deltaOf(
                bundle.deals.wonValue.current,
                bundle.deals.wonValue.previous,
                (n) => money(Math.abs(n)),
                t("vsPrevious"),
              )}
            />
            <MetricCard
              title={t("statWon")}
              value={bundle.deals.wonCount.current}
              delta={deltaOf(
                bundle.deals.wonCount.current,
                bundle.deals.wonCount.previous,
                (n) => String(Math.abs(n)),
                t("vsPrevious"),
              )}
            />
            <MetricCard
              title={t("statWinRate")}
              value={
                bundle.deals.winRate === null
                  ? "—"
                  : `${Math.round(bundle.deals.winRate * 100)}%`
              }
              subtitle={
                bundle.deals.winRate === null ? t("nothingClosed") : undefined
              }
            />
            <MetricCard
              title={t("statTicket")}
              value={bundle.deals.averageTicket ?? "—"}
              format={money}
            />
          </>
        )}
      </DisplayHeading>

      {/* The period is printed in the heading area by the data itself;
          the chips and the print button are only useful on screen. */}
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        data-print="hide"
      >
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            items={chips}
            value={period}
            onChange={setPeriod}
            ariaLabel={t("periodLabel")}
          />
          {period === "custom" ? (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setBound("from", e.target.value)}
                aria-label={t("customFrom")}
                className="h-8 w-auto text-xs"
              />
              <span className="text-xs text-muted-foreground">
                {t("customTo")}
              </span>
              <Input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setBound("to", e.target.value)}
                aria-label={t("customTo")}
                className="h-8 w-auto text-xs"
              />
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.print()}
        >
          <Printer />
          {t("printPdf")}
        </Button>
      </div>

      {/* The close dates are guesses until migration 046 runs, and a
          report that doesn't say so is a report that gets quoted. */}
      {bundle?.deals.approximate ? (
        <p className="surface rounded-2xl px-4 py-3 text-xs text-muted-foreground">
          {t("approximateWarning")}
        </p>
      ) : null}

      {error ? (
        <div className="surface rounded-2xl px-6 py-12 text-center">
          <p className="text-sm text-foreground">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {bundle === null && !error ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : null}

      {bundle ? (
        <>
          <AnalystPanel query={query} canAsk={canAsk} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal index={0}>
              <ReportCard
                title={t("cardClosedByDay")}
                hint={t("cardClosedByDayHint")}
                exportId="deals_by_day"
                query={query}
              >
                <DayBars
                  data={bundle.dealsByDay}
                  labelA={t("won")}
                  labelB={t("lost")}
                  tone="polarity"
                />
              </ReportCard>
            </Reveal>

            <Reveal index={1}>
              <ReportCard
                title={t("cardFunnel")}
                hint={t("cardFunnelHint")}
                exportId="funnel"
                query={query}
              >
                <CategoryBars
                  rows={bundle.funnel}
                  formatValue={money}
                  keepOrder
                />
              </ReportCard>
            </Reveal>

            <Reveal index={2}>
              <ReportCard
                title={t("cardForecast")}
                hint={t("cardForecastHint")}
                exportId="forecast"
                query={query}
              >
                <CategoryBars
                  rows={bundle.forecast.map((b) => ({
                    key: b.bucket,
                    label: t(`forecast_${b.bucket}`),
                    count: b.count,
                    value: b.value,
                  }))}
                  formatValue={money}
                  keepOrder
                />
              </ReportCard>
            </Reveal>

            <Reveal index={3}>
              <ReportCard
                title={t("cardOwners")}
                exportId="deals_by_owner"
                query={query}
              >
                <CategoryBars
                  rows={bundle.dealsByOwner}
                  formatValue={money}
                  keepOrder
                />
              </ReportCard>
            </Reveal>

            <Reveal index={4}>
              <ReportCard
                title={t("cardLeadsByDay")}
                exportId="contacts_by_day"
                query={query}
              >
                <DayBars
                  data={bundle.contactsByDay.map((p) => ({
                    day: p.day,
                    a: p.value,
                  }))}
                  labelA={t("newLeads")}
                />
              </ReportCard>
            </Reveal>

            <Reveal index={5}>
              <ReportCard
                title={t("cardLeadSource")}
                hint={t("cardLeadSourceHint")}
                exportId="contacts_by_source"
                query={query}
              >
                <CategoryBars rows={bundle.contactsBySource} />
              </ReportCard>
            </Reveal>

            <Reveal index={6}>
              <ReportCard
                title={t("cardTemperature")}
                exportId="contacts_by_temperature"
                query={query}
              >
                <CategoryBars
                  rows={bundle.contactsByTemperature}
                  labelFor={(row) => temperatureLabel(row.key, t)}
                />
              </ReportCard>
            </Reveal>

            <Reveal index={7}>
              <ReportCard
                title={t("cardSegment")}
                exportId="contacts_by_segment"
                query={query}
              >
                <CategoryBars rows={bundle.contactsBySegment} />
              </ReportCard>
            </Reveal>

            <Reveal index={8}>
              <ReportCard
                title={t("cardMessages")}
                exportId="messages_by_day"
                query={query}
              >
                <DayBars
                  data={bundle.messagesByDay}
                  labelA={t("received")}
                  labelB={t("sent")}
                  format={(n) => formatCompactNumber(n)}
                />
              </ReportCard>
            </Reveal>

            <Reveal index={9}>
              <ReportCard
                title={t("cardConversations")}
                hint={t("cardConversationsHint")}
                exportId="conversations_by_status"
                query={query}
              >
                <CategoryBars
                  rows={bundle.conversationsByStatus}
                  labelFor={(row) => conversationLabel(row.key, t)}
                />
              </ReportCard>
            </Reveal>
          </div>

          {bundle.agents ? (
            <div className="space-y-4">
              <h2 className="eyebrow">{t("agentsSection")}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                <ReportCard
                  title={t("cardGoals")}
                  hint={t("cardGoalsHint")}
                  exportId="agent_goals"
                  query={query}
                >
                  <GoalMeters rows={bundle.agents.goals} />
                </ReportCard>

                <ReportCard
                  title={t("cardAgentRuns")}
                  exportId="agent_runs"
                  query={query}
                >
                  {bundle.agents.runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("noData")}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {bundle.agents.runs.map((run) => (
                        <li
                          key={run.agentId || run.agentName}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {run.agentName}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t("runSummary", {
                              replied: run.replied,
                              handoff: run.handoff,
                              failed: run.failed,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </ReportCard>

                <ReportCard
                  title={t("cardTasks")}
                  exportId="agent_tasks"
                  query={query}
                >
                  <CategoryBars
                    rows={bundle.agents.tasksByKind}
                    labelFor={(row) => taskKindLabel(row.key, ta, t)}
                  />
                </ReportCard>

                <ReportCard
                  title={t("cardCost")}
                  hint={t("cardCostHint")}
                  exportId="agent_cost"
                  query={query}
                >
                  {bundle.agents.cost.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("noData")}
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {bundle.agents.cost.map((row) => (
                        <li
                          key={row.agentId || row.agentName}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {row.agentName || t("removedAgent")}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t("costSummary", {
                              cost: row.costUsd.toFixed(4),
                              tasks: row.tasks,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </ReportCard>
              </div>

              <div className="surface flex flex-wrap items-end gap-8 rounded-2xl p-5 sm:gap-12">
                <MetricCard
                  title={t("approvalsPending")}
                  value={bundle.agents.approvals.pending}
                />
                <MetricCard
                  title={t("approvalsApproved")}
                  value={bundle.agents.approvals.approved}
                />
                <MetricCard
                  title={t("approvalsRejected")}
                  value={bundle.agents.approvals.rejected}
                />
                <MetricCard
                  title={t("approvalsMedian")}
                  value={
                    bundle.agents.approvals.medianDecisionMinutes === null
                      ? "—"
                      : `${bundle.agents.approvals.medianDecisionMinutes}`
                  }
                  suffix={
                    bundle.agents.approvals.medianDecisionMinutes === null
                      ? undefined
                      : t("minutesSuffix")
                  }
                />
              </div>
            </div>
          ) : (
            <p className="surface rounded-2xl px-4 py-3 text-xs text-muted-foreground">
              {t("agentsUnavailable")}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Arrow + "+N vs período anterior", or nothing when both are zero. */
function deltaOf(
  current: number,
  previous: number,
  format: (value: number) => string,
  suffix: string,
): { sign: number; label: string } | undefined {
  if (current === 0 && previous === 0) return undefined;
  const diff = current - previous;
  const sign = diff === 0 ? 0 : diff > 0 ? 1 : -1;
  const prefix = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return { sign, label: `${prefix}${format(diff)} ${suffix}` };
}

type T = ReturnType<typeof useTranslations>;

function temperatureLabel(key: string, t: T): string {
  if (key === "cold" || key === "warm" || key === "hot") {
    return t(`temperature_${key}`);
  }
  return key === "__unassigned__" ? t("unknownBucket") : key;
}

function conversationLabel(key: string, t: T): string {
  if (key === "open" || key === "pending" || key === "closed") {
    return t(`conversation_${key}`);
  }
  return key === "__unassigned__" ? t("unknownBucket") : key;
}

/**
 * Task kinds are free text in the column, so this never builds a
 * translation key from the stored value — an unknown kind shows as
 * stored rather than crashing next-intl on a missing message.
 */
const KNOWN_TASK_KINDS = new Set([
  "outreach",
  "followup",
  "negotiate",
  "close",
  "onboard",
  "reply",
  "research",
  "qualify",
  "prospect",
]);

function taskKindLabel(key: string, ta: T, t: T): string {
  if (KNOWN_TASK_KINDS.has(key)) return ta(`taskKind_${key}`);
  if (key === "__unassigned__") return t("unknownBucket");
  if (key === "__other__") return t("otherBucket");
  return key;
}
