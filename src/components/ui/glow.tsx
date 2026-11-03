"use client";

import { cn } from "@/lib/utils";

/**
 * Ambient accent wash — a slowly drifting radial bloom that sits
 * behind content to give a flat surface some depth.
 *
 * Painted from `--primary`, so it follows whichever accent the user
 * picked (violet / emerald / cobalt / amber / rose) and dims itself in
 * light mode where it sits under dark type. Purely decorative, hence
 * `aria-hidden` and `pointer-events-none`.
 *
 * The caller owns size and position; this owns the paint:
 *
 *   <div className="relative isolate">
 *     <Glow className="-top-40 left-1/4 h-96 w-96" />
 *     …
 *   </div>
 */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "fx-glow pointer-events-none absolute -z-10 rounded-full",
        className,
      )}
    />
  );
}
