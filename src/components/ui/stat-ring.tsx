import { cn } from "@/lib/utils";

interface StatRingProps {
  /** How many are "on" — drives both the lit segments and the big number. */
  value: number;
  /** The denominator. Also the default segment count. */
  total: number;
  /** Small caption under the number, e.g. "ativos". Optional. */
  label?: string;
  /** Outer diameter in px. The stroke and type scale off this. */
  size?: number;
  /**
   * Segment count. Defaults to `total`, which is what you want for a
   * small countable set (4 agents → 4 dashes). Pass a fixed number
   * when `total` can grow large — 60 hairline dashes read as a smear,
   * not as a gauge.
   */
  segments?: number;
  className?: string;
}

/**
 * The segmented gauge from the workspace headings: a ring of discrete
 * dashes where the lit ones count what is currently switched on.
 *
 * Discrete rather than a continuous arc on purpose. These numbers are
 * small and countable — "4 of 6 agents are live" — and a solid arc
 * forces the reader to estimate an angle to recover a number they
 * could otherwise just count. The dashes also degrade gracefully: at
 * a glance it's a progress ring, up close it's a tally.
 *
 * Each dash is its own <circle> with `pathLength` normalised to the
 * segment count, so one unit of dash array = one segment regardless
 * of the radius. That makes the geometry independent of `size` — no
 * circumference math at any call site.
 */
export function StatRing({
  value,
  total,
  label,
  size = 108,
  segments,
  className,
}: StatRingProps) {
  const count = Math.max(1, Math.min(segments ?? total ?? 1, 24));
  const safeTotal = Math.max(total, 0);
  // Lit dashes are proportional, so a 12-dash ring still reads right
  // when the real total is 40. Anything above zero lights at least one
  // dash — "1 of 40 running" should not look identical to "none".
  const ratio = safeTotal > 0 ? Math.min(value / safeTotal, 1) : 0;
  const lit = value > 0 ? Math.max(1, Math.round(ratio * count)) : 0;

  const stroke = Math.round(size * 0.075);
  const radius = (size - stroke) / 2;
  const center = size / 2;
  // Leave ~30% of each slot as the gap between dashes.
  const dash = 0.7;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        label
          ? `${value} de ${safeTotal} ${label}`
          : `${value} de ${safeTotal}`
      }
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Start the tally at 12 o'clock instead of 3 o'clock.
        className="-rotate-90"
        aria-hidden
      >
        {Array.from({ length: count }, (_, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={count}
            // One visible dash of 0.7 units starting at slot `i`, then
            // a gap long enough to swallow the rest of the ring.
            strokeDasharray={`${dash} ${count - dash}`}
            strokeDashoffset={-i}
            className={
              i < lit
                ? "text-primary"
                : "text-foreground/12"
            }
            stroke="currentColor"
            style={
              i < lit
                ? {
                    transition: "opacity 0.4s ease",
                  }
                : undefined
            }
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="flex items-start font-light tabular-nums leading-none text-foreground">
          <span style={{ fontSize: size * 0.3 }}>{value}</span>
          <span
            className="mt-0.5 text-muted-foreground"
            style={{ fontSize: size * 0.14 }}
          >
            /{safeTotal}
          </span>
        </p>
        {label ? (
          <p
            className="mt-1 text-muted-foreground"
            style={{ fontSize: Math.max(10, size * 0.105) }}
          >
            {label}
          </p>
        ) : null}
      </div>
    </div>
  );
}
