"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  /**
   * Renders the interpolated value. Defaults to locale-grouped digits;
   * pass a `formatCurrency`-style helper for money.
   */
  format?: (value: number) => string;
  /** Total run time in milliseconds. */
  duration?: number;
  className?: string;
}

const defaultFormat = (value: number) => value.toLocaleString();

// Cubic ease-out: quick off the mark, long settle. Counting numbers
// read best when they decelerate — a linear count looks mechanical.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts up to `value` instead of snapping to it, so a metric that
 * changed tells you it changed.
 *
 * Re-animates whenever `value` changes and always starts from the
 * number currently on screen, so a dashboard refresh counts from the
 * old figure to the new one rather than restarting at zero.
 */
export function AnimatedNumber({
  value,
  format = defaultFormat,
  duration = 900,
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  // Mirrors `display` every frame. State alone can't drive the next
  // run's starting point: the effect closure would capture whatever
  // was rendered when it ran, not the frame the animation actually
  // reached before being interrupted.
  const currentRef = useRef(0);

  useEffect(() => {
    const from = currentRef.current;
    if (from === value) return;

    // Someone who asked for less motion still needs the number — they
    // just get it without the count. Collapsing the duration rather
    // than branching to a setState keeps a single code path: the first
    // frame computes t = 1 and lands on the exact value.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const runtime = reduced ? 0 : duration;

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = runtime <= 0 ? 1 : Math.min((now - start) / runtime, 1);

      // Intermediate frames are rounded — on a currency value the cents
      // would otherwise churn through every digit on the way up. The
      // final frame takes `value` verbatim, because rounding there
      // would turn 1250.75 into 1251 permanently.
      const next =
        t < 1 ? Math.round(from + (value - from) * easeOut(t)) : value;

      currentRef.current = next;
      setDisplay(next);

      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
}
