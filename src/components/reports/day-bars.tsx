"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export interface DayBarPoint {
  day: string;
  a: number;
  b?: number;
}

interface DayBarsProps {
  data: DayBarPoint[];
  labelA: string;
  /** Omit for a single series — then no legend is drawn. */
  labelB?: string;
  /**
   * `identity` for two unrelated series (messages in vs out).
   * `polarity` for good vs bad (won vs lost), which gets the
   * blue↔red pair rather than green/red — see the note on the
   * `--viz-*` tokens in globals.css.
   */
  tone?: "identity" | "polarity";
  format?: (value: number) => string;
}

const PLOT_HEIGHT = 168;

/**
 * Counts per day, as stacked bars.
 *
 * Bars rather than a line because these series are daily event counts
 * — deals closing, leads arriving — which are mostly zero with spikes.
 * A line drawn through mostly-zero data slopes between the spikes and
 * invents activity on the quiet days; a bar chart leaves them visibly
 * empty, which is the truth.
 *
 * Stacked rather than grouped because the two series are the same
 * unit and their total means something (deals *decided* that day,
 * total messages that day), and because at 90 days a grouped pair
 * would be 180 bars across the width of a card.
 */
export function DayBars({
  data,
  labelA,
  labelB,
  tone = "identity",
  format = (v) => String(v),
}: DayBarsProps) {
  const t = useTranslations("Reports");
  const [hover, setHover] = useState<number | null>(null);

  const colorA = tone === "polarity" ? "var(--viz-pos)" : "var(--viz-series-1)";
  const colorB = tone === "polarity" ? "var(--viz-neg)" : "var(--viz-series-2)";

  const { max, peakIndex, empty } = useMemo(() => {
    let max = 0;
    let peakIndex = -1;
    for (const [i, point] of data.entries()) {
      const total = point.a + (point.b ?? 0);
      if (total > max) {
        max = total;
        peakIndex = i;
      }
    }
    return { max, peakIndex, empty: max === 0 };
  }, [data]);

  if (data.length === 0 || empty) {
    // Compact, with no reserved plot height. Holding the full 168px
    // open draws a large empty rectangle that reads as a chart which
    // failed to render, rather than as a period in which nothing
    // happened. Nothing jumps: these cards sit in a grid whose rows
    // already equalise height.
    return (
      <p
        className="py-6 text-center text-xs text-muted-foreground"
        aria-label={t("noMovement")}
      >
        {t("noMovement")}
      </p>
    );
  }

  const hovered = hover !== null ? data[hover] : null;
  const peak = peakIndex >= 0 ? data[peakIndex] : null;

  return (
    <div>
      {/* One selective direct label instead of a number on every bar:
          at 90 days there is no room, and the peak is the value people
          actually look for. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        {labelB ? (
          <div className="flex items-center gap-3">
            <Legend color={colorA} label={labelA} />
            <Legend color={colorB} label={labelB} />
          </div>
        ) : null}
        {peak ? (
          <p className="text-muted-foreground">
            {t("peak", {
              value: format(peak.a + (peak.b ?? 0)),
              day: shortDay(peak.day),
            })}
          </p>
        ) : null}
      </div>

      <div className="relative">
        {hovered ? (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-xl bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-lg ring-1 ring-border"
            style={{
              left: `${((hover! + 0.5) / data.length) * 100}%`,
            }}
          >
            <p className="font-medium">{longDay(hovered.day)}</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <Dot color={colorA} />
              {labelA}: <span className="tabular-nums">{format(hovered.a)}</span>
            </p>
            {labelB ? (
              <p className="flex items-center gap-1.5">
                <Dot color={colorB} />
                {labelB}:{" "}
                <span className="tabular-nums">{format(hovered.b ?? 0)}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div
          className="flex items-end gap-px"
          style={{ height: PLOT_HEIGHT }}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={t("seriesAria", { label: labelA, count: data.length })}
        >
          {data.map((point, i) => {
            const total = point.a + (point.b ?? 0);
            const heightPct = max === 0 ? 0 : (total / max) * 100;
            const hasB = point.b !== undefined && point.b > 0;
            return (
              <div
                key={point.day}
                className="group relative flex h-full flex-1 cursor-default flex-col justify-end"
                onMouseEnter={() => setHover(i)}
              >
                {/* Hit target spans the full column height, so a short
                    bar is still easy to hover. */}
                <div
                  className={cn(
                    "flex flex-col-reverse gap-[2px] transition-opacity",
                    hover !== null && hover !== i && "opacity-45",
                  )}
                  style={{ height: `${heightPct}%`, minHeight: total > 0 ? 2 : 0 }}
                >
                  {/* The rounded end belongs to whichever segment is
                      actually on top, so a day with no `b` still reads
                      as a finished bar rather than a cut-off one. */}
                  {point.a > 0 ? (
                    <div
                      className={cn(
                        "w-full rounded-b-[2px]",
                        !hasB && "rounded-t-[4px]",
                      )}
                      style={{
                        background: colorA,
                        flexGrow: point.a,
                        flexBasis: 0,
                      }}
                    />
                  ) : null}
                  {hasB ? (
                    <div
                      className="w-full rounded-t-[4px]"
                      style={{
                        background: colorB,
                        flexGrow: point.b,
                        flexBasis: 0,
                      }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="mt-2 flex justify-between border-t pt-2 text-[0.7rem]"
          style={{ borderColor: "var(--viz-grid)", color: "var(--viz-axis)" }}
        >
          <span>{shortDay(data[0]!.day)}</span>
          <span>{shortDay(data[data.length - 1]!.day)}</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <Dot color={color} />
      {label}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: color }}
      aria-hidden
    />
  );
}

/**
 * `YYYY-MM-DD` keys are already local to the report's zone, so they
 * are split by hand rather than passed through `new Date(key)` — that
 * parses as UTC midnight and renders the previous day for anyone west
 * of Greenwich. The same bug the repo's own date-utils test is failing
 * on.
 */
function parts(key: string): { d: string; m: string } {
  const [, m = "01", d = "01"] = key.split("-");
  return { d, m };
}

function shortDay(key: string): string {
  const { d, m } = parts(key);
  return `${d}/${m}`;
}

function longDay(key: string): string {
  const { d, m } = parts(key);
  const [y] = key.split("-");
  return `${d}/${m}/${y}`;
}
