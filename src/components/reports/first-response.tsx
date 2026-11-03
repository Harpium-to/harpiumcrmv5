"use client";

import { useTranslations } from "next-intl";

import type { FirstResponseSummary } from "@/lib/reports/types";

import { DayBars } from "./day-bars";

/** "4,5 min" — the comma the reader expects, one decimal at most. */
function minutes(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
}

/**
 * How long a customer waits for the first answer.
 *
 * Median and the 90th percentile rather than an average: one weekend
 * wait of 40 hours drags a mean to "três horas" while most people were
 * answered in minutes. The median is what a typical customer felt; p90
 * is how bad it gets for the unlucky one in ten.
 *
 * Waits still without an answer are their own number. Folding them in
 * as zero would make an unanswered inbox look fast.
 */
export function FirstResponse({ summary }: { summary: FirstResponseSummary }) {
  const t = useTranslations("Reports");

  if (summary.replied === 0 && summary.unreplied === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  const stats = [
    { label: t("firstResponseMedian"), value: minutes(summary.medianMinutes) },
    { label: t("firstResponseP90"), value: minutes(summary.p90Minutes) },
    { label: t("firstResponseUnreplied"), value: String(summary.unreplied) },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-4 lg:grid-cols-1">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        {summary.byResponder.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {summary.byResponder.map((row) => (
              <li key={row.responder} className="flex justify-between gap-3">
                <span>
                  {row.responder === "bot"
                    ? t("firstResponseByBot")
                    : row.responder === "agent"
                      ? t("firstResponseByPerson")
                      : row.responder}
                </span>
                <span className="tabular-nums text-foreground">
                  {minutes(row.medianMinutes)}
                  <span className="text-muted-foreground"> · {row.replied}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <DayBars
        data={summary.byDay.map((d) => ({ day: d.day, a: d.medianMinutes ?? 0 }))}
        labelA={t("firstResponseMedian")}
        format={(n) => minutes(n)}
      />
    </div>
  );
}
