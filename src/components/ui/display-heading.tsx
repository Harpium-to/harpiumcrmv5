import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DisplayHeadingProps {
  /** First line — the loud one. */
  title: string;
  /**
   * Second line, set in the same size but dimmed. Splitting the
   * heading across two weights is what gives these screens their
   * poster-like top edge ("Aparelhos" / "da casa"). Optional: a
   * one-word section doesn't need it.
   */
  subtitle?: string;
  /** Rendered to the right of the heading — the ring + stat row. */
  children?: ReactNode;
  className?: string;
}

/**
 * The page's opening statement: an oversized two-tone heading with
 * room beside it for the numbers that summarise the screen.
 *
 * The type scale lives in `.display` (globals.css) and is fluid, so
 * this reads as a poster on a wide monitor and still fits a phone
 * without a separate mobile heading. On narrow screens the stat row
 * wraps underneath rather than shrinking the heading — the numbers
 * are what people scan for, so they keep their size.
 */
export function DisplayHeading({
  title,
  subtitle,
  children,
  className,
}: DisplayHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-10 gap-y-6",
        className,
      )}
    >
      <h1 className="display text-foreground">
        {title}
        {subtitle ? (
          <>
            <br />
            <span className="text-foreground/35">{subtitle}</span>
          </>
        ) : null}
      </h1>
      {children ? (
        <div className="flex flex-wrap items-end gap-8 sm:gap-12">
          {children}
        </div>
      ) : null}
    </div>
  );
}
