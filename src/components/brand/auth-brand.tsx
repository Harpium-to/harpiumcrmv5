import type { CSSProperties } from "react";

import { HarpiumMark } from "@/components/brand/harpium-mark";

/**
 * The brand that opens every auth screen (login, signup, forgot and
 * reset password): the eagle draws itself, then the name rises under
 * it. The card below should enter after it — pass
 * `AUTH_CARD_ENTER` to its props — so the eye lands on the mark first
 * and the form second.
 */
export function AuthBrand() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex size-28 items-center justify-center">
        <span
          aria-hidden
          className="hm-halo absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.14),transparent_68%)]"
        />
        <HarpiumMark animated className="relative w-24" />
      </div>
      <div
        data-reveal="shown"
        style={{ "--enter-delay": "900ms" } as CSSProperties}
        className="flex items-baseline gap-2"
      >
        <span className="text-2xl font-semibold tracking-[0.18em] text-foreground uppercase">
          Harpium
        </span>
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          CRM
        </span>
      </div>
    </div>
  );
}

/** Spread on the auth card: it rises once the brand has drawn. */
export const AUTH_CARD_ENTER = {
  "data-reveal": "shown",
  style: { "--enter-delay": "1100ms" } as CSSProperties,
} as const;

/** Outer layout of an auth screen: brand on top, card below. */
export const AUTH_SCREEN_CLASS =
  "flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10";
