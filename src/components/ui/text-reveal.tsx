"use client";

import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface TextRevealProps {
  children: string;
  /** Milliseconds between consecutive words. */
  step?: number;
  /** Delay before the first word moves. */
  delay?: number;
  className?: string;
}

/**
 * Reveals a heading word by word, each one climbing out from behind its
 * own clipping box.
 *
 * Meant for the one heading that introduces a screen — used on a whole
 * page of copy it reads as a gimmick and delays reading.
 *
 * Accessibility: the full string is exposed once to screen readers and
 * the per-word slices are hidden from them, so the text is announced as
 * a sentence rather than as a stream of disconnected words.
 */
export function TextReveal({
  children,
  step = 55,
  delay = 0,
  className,
}: TextRevealProps) {
  const words = children.split(" ");

  return (
    <span className={cn("inline-flex flex-wrap", className)}>
      <span className="sr-only">{children}</span>

      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          aria-hidden
          // The clip box has to sit below the baseline or descenders
          // (g, y, p) get shaved off; the negative margin cancels the
          // padding so line height is unchanged.
          className="inline-flex overflow-hidden pb-[0.14em] -mb-[0.14em]"
        >
          <span
            className="fx-cut-line whitespace-pre"
            style={{ "--enter-delay": `${delay + i * step}ms` } as CSSProperties}
          >
            {i < words.length - 1 ? `${word} ` : word}
          </span>
        </span>
      ))}
    </span>
  );
}
