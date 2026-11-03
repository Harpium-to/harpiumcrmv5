"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Replays the page-enter animation on every client-side navigation.
 *
 * A layout doesn't remount when only the page under it changes, so a
 * plain `.fx-page` class would animate on first load and never again.
 * Keying on the pathname forces this wrapper to remount, which restarts
 * the CSS animation. One wrapper in a layout is what gives every route
 * beneath it a transition, with no per-page opt-in.
 *
 * `children` arrives as an already-rendered prop, so wrapping a server
 * layout's content in this client component does not pull that content
 * into the client bundle.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="fx-page">
      {children}
    </div>
  );
}
