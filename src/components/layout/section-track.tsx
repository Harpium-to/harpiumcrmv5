"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { revealDelta, scrollEdges } from "@/lib/scroll-edges";
import { PillNav, type PillItem } from "@/components/ui/pill-nav";

/** Old `?tab=` values that now live inside another section. */
const TAB_ALIASES: Record<string, string> = { playground: "setup" };

/**
 * The top bar's pill track for the current screen's sections.
 *
 * The bar shares its width with the brand, the chips and the account,
 * so a screen with many sections (Agentes has seven) does not fit on a
 * laptop. The track scrolls sideways, and two things make that visible
 * instead of leaving sections silently past the edge:
 *   - an arrow at each end that has more, which scrolls that way;
 *   - the selected section is brought into view, so landing on one
 *     near the end never looks like nothing is selected.
 *
 * Reads `?tab=` behind the Suspense boundary Next requires for
 * `useSearchParams`, so the rest of the bar never suspends.
 */
export function SectionTrack({
  items,
  fallbackValue,
  className,
}: {
  items: PillItem[];
  fallbackValue: string;
  className?: string;
}) {
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab = raw ? (TAB_ALIASES[raw] ?? raw) : null;
  const value = tab && items.some((i) => i.value === tab) ? tab : fallbackValue;

  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const next = scrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth);
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  // Bring the selected section fully into view (room left for the arrow).
  const revealActive = useCallback(() => {
    const el = trackRef.current;
    const active = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (!el || !active) return;
    const delta = revealDelta(el.getBoundingClientRect(), active.getBoundingClientRect());
    if (delta !== 0) el.scrollLeft += delta;
  }, []);

  // Watch for anything that changes what is cut off: scrolling, the
  // bar resizing (window, account name loading), the items changing.
  // A resize also re-reveals the selected section: the bar narrows
  // after the first paint, when the account's name arrives, and a
  // section revealed before that ends up half under the arrow.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => {
      revealActive();
      measure();
    });
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, revealActive, items.length]);

  // And whenever the selection changes.
  useEffect(() => {
    revealActive();
  }, [value, revealActive]);

  const scroll = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  // Mouse affordance only: keyboard and screen-reader users reach
  // every section through the links themselves (focus scrolls them in).
  const arrow =
    "absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-md ring-1 ring-foreground/10 transition-colors hover:bg-muted";

  return (
    <div className={cn("relative max-w-full min-w-0", className)}>
      <PillNav
        ref={trackRef}
        items={items}
        value={value}
        className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      />
      {edges.left ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title="Seções anteriores"
          onClick={() => scroll(-1)}
          className={cn(arrow, "left-1")}
        >
          <ChevronLeft className="size-4" />
        </button>
      ) : null}
      {edges.right ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title="Mais seções"
          onClick={() => scroll(1)}
          className={cn(arrow, "right-1")}
        >
          <ChevronRight className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
