"use client";

import { useTranslations } from "next-intl";

import { OTHER, UNASSIGNED } from "@/lib/reports/aggregate";
import type { BreakdownRow } from "@/lib/reports/types";

interface CategoryBarsProps {
  rows: BreakdownRow[];
  /** Formats the measure column; omit to show the count alone. */
  formatValue?: (value: number) => string;
  /** Keep the given order (funnel stages) instead of sorting by size. */
  keepOrder?: boolean;
  /** Translate a sentinel or enum key into words. */
  labelFor?: (row: BreakdownRow) => string;
}

/**
 * A breakdown as rows of label, bar and number.
 *
 * One hue for every bar, because this is a *magnitude* chart: the
 * categories are identified by their labels, not by colour. Painting
 * each row a different colour is the most common mistake in this
 * shape — it implies the colours mean something, and it makes a
 * filter that drops one row repaint all the others.
 *
 * It is also deliberately a table with bars in it rather than a chart
 * with a legend. The number is always present next to its label, so
 * the figure survives colour-blindness, a greyscale print and a
 * screen reader, and there is no separate "table view" to maintain.
 */
export function CategoryBars({
  rows,
  formatValue,
  keepOrder = false,
  labelFor,
}: CategoryBarsProps) {
  const t = useTranslations("Reports");

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
  }

  const ordered = keepOrder ? rows : [...rows];
  // Scale against the largest bar, not the total: with one dominant
  // row every other bar would be a sliver.
  const max = ordered.reduce(
    (m, row) => Math.max(m, formatValue ? (row.value ?? 0) : row.count),
    0,
  );

  return (
    <ul className="space-y-2.5">
      {ordered.map((row) => {
        const measure = formatValue ? (row.value ?? 0) : row.count;
        const pct = max === 0 ? 0 : (measure / max) * 100;
        const label = labelFor?.(row) ?? defaultLabel(row, t);
        return (
          <li key={row.key} className="grid grid-cols-[1fr_auto] gap-x-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-foreground">
                {label}
              </span>
            </div>
            <span className="text-right text-sm tabular-nums text-muted-foreground">
              {formatValue ? formatValue(row.value ?? 0) : row.count}
              {formatValue ? (
                <span className="ml-2 text-xs opacity-60">({row.count})</span>
              ) : null}
            </span>
            <div
              className="col-span-2 mt-1 h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--viz-grid)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pct, measure > 0 ? 1.5 : 0)}%`,
                  background: "var(--viz-series-1)",
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The sentinel keys the aggregation emits get words here rather than
 * leaking `__unassigned__` onto the screen. Anything else is already a
 * real value from the database and is shown as stored.
 */
function defaultLabel(
  row: BreakdownRow,
  t: ReturnType<typeof useTranslations>,
): string {
  if (row.key === UNASSIGNED) return t("unknownBucket");
  if (row.key === OTHER) return t("otherBucket");
  return row.label || row.key;
}
