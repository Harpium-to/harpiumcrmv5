"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { GoalAttainmentRow } from "@/lib/reports/types";

/**
 * Target versus actual, one row per agent per metric.
 *
 * The unmeasured rows are the point of this component. Three of the
 * goal metrics have nothing in the schema to count — there is no
 * meetings table, no proposals table, and deals carry no AI-agent
 * attribution — so they render as a stated limitation with no meter at
 * all. Drawing them as an empty bar at 0% would say the agent failed,
 * and somebody would switch off an agent that is working fine. A gap
 * in the product and a gap in performance must not look alike.
 */
export function GoalMeters({ rows }: { rows: GoalAttainmentRow[] }) {
  const t = useTranslations("Reports");
  const ta = useTranslations("Agents");

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noGoals")}</p>;
  }

  return (
    <ul className="space-y-4">
      {rows.map((row) => {
        const label = row.metricLabelKey
          ? ta(row.metricLabelKey)
          : row.metricId;
        const pct =
          row.ratio === null ? 0 : Math.min(Math.round(row.ratio * 100), 100);
        return (
          <li key={`${row.agentId}-${row.metricId}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-foreground">
                {row.agentName}
                <span className="text-muted-foreground"> · {label}</span>
              </span>
              {row.measured ? (
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {row.actual} / {formatTarget(row.target)}
                  <span
                    className={cn(
                      "ml-2 text-xs",
                      (row.ratio ?? 0) >= 1 && "text-foreground",
                    )}
                  >
                    {row.ratio === null ? "" : `${Math.round(row.ratio * 100)}%`}
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("goalUnmeasured")}
                </span>
              )}
            </div>
            {row.measured ? (
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--viz-grid)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(pct, (row.actual ?? 0) > 0 ? 1.5 : 0)}%`,
                    background: "var(--viz-series-1)",
                  }}
                />
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground/70">
                {t("goalUnmeasuredHint")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Drop the decimals a scaled target picks up: "7" beats "7.03". */
function formatTarget(target: number): string {
  return target >= 10 ? String(Math.round(target)) : String(Math.round(target * 10) / 10);
}
