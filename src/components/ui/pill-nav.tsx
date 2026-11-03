"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface PillItem {
  /** Stable key, and the value reported by `onChange` in button mode. */
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Present → the pill renders as a <Link> instead of a <button>. */
  href?: string;
  /** Small count rendered after the label (unread, pending, …). */
  badge?: number;
}

interface PillNavProps {
  items: PillItem[];
  /** The selected item's `value`. */
  value: string;
  /** Omit in link mode. */
  onChange?: (value: string) => void;
  /** Visually hidden label for the surrounding nav/tablist. */
  ariaLabel?: string;
  className?: string;
}

/**
 * The floating segmented control that sits in the top bar and above
 * tabbed panels — one track, one lit pill.
 *
 * It takes either `href`s (route tabs, rendered as links so middle-
 * click and prefetch work) or an `onChange` (local panel switching).
 * Mixing the two in one `items` array is fine: each item decides for
 * itself. Selection is expressed as `data-active` on the element and
 * styled by `.pill` in globals.css, so the active treatment can be
 * retuned once for every segmented control in the app.
 */
export function PillNav({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: PillNavProps) {
  return (
    <div
      className={cn("pill-track", className)}
      role={onChange ? "tablist" : undefined}
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.value === value;
        const inner = (
          <>
            {item.icon ? <item.icon className="size-4" /> : null}
            <span>{item.label}</span>
            {item.badge && item.badge > 0 ? (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 text-[11px] font-medium tabular-nums",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-foreground/10 text-foreground",
                )}
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </>
        );

        if (item.href) {
          return (
            <Link
              key={item.value}
              href={item.href}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className="pill"
            >
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            onClick={() => onChange?.(item.value)}
            className="pill"
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

interface FilterChipsProps {
  items: PillItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * The untracked filter row that sits directly under a page heading
 * ("Todos / Comercial / Atendimento"). Same selection grammar as
 * `PillNav`, but each chip carries its own edge because there is no
 * track behind it, and the selected one goes fully solid — it is a
 * filter that changes what you're looking at, so it earns more weight
 * than a tab that only swaps a panel.
 */
export function FilterChips({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: FilterChipsProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            data-active={active}
            onClick={() => onChange(item.value)}
            className="chip"
          >
            {item.icon ? <item.icon className="size-4" /> : null}
            <span>{item.label}</span>
            {typeof item.badge === "number" ? (
              <span
                className={cn(
                  "tabular-nums",
                  active ? "opacity-70" : "opacity-60",
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
