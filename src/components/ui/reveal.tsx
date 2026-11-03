"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /**
   * Position in a cascade. Multiplied by `step` to stagger siblings —
   * pass the map index and a group animates in sequence.
   */
  index?: number;
  /** Milliseconds between consecutive `index` values. */
  step?: number;
  /** Extra delay added on top of the staggered one. */
  delay?: number;
  className?: string;
}

/**
 * Rises its children into place (translate + de-blur) the first time
 * they scroll into view.
 *
 * The visuals live in globals.css under `[data-reveal]`; this component
 * only decides *when* to flip the attribute. Keeping that split means
 * the prefers-reduced-motion escape hatch is written once, in CSS, and
 * cannot be forgotten at a call site.
 *
 * Stagger a group by passing the index:
 *
 *   {items.map((item, i) => (
 *     <Reveal key={item.id} index={i}>…</Reveal>
 *   ))}
 */
export function Reveal({
  children,
  index = 0,
  step = 70,
  delay = 0,
  className,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The attribute is flipped on the node instead of through state on
    // purpose: its only consumer is a CSS selector, so a re-render
    // would buy nothing and every revealed element would cost one.
    // React won't undo this — it only patches an attribute when the
    // rendered value changes, and this one is a constant below.
    const show = () => {
      el.dataset.reveal = "shown";
    };

    // jsdom (vitest) and pre-2019 browsers have no observer. Reveal
    // immediately there — the alternative is content stranded at
    // opacity 0, which is a blank page rather than a missing flourish.
    if (typeof IntersectionObserver === "undefined") {
      show();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        show();
        // One-shot. Replaying every time a row scrolls back past the
        // fold turns a long list into a flickering mess.
        observer.disconnect();
      },
      // Trigger a little before the element is fully on screen so the
      // animation is already settling as it arrives.
      { rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-reveal="pending"
      style={{ "--enter-delay": `${index * step + delay}ms` } as CSSProperties}
      className={className}
    >
      {children}
    </div>
  );
}
