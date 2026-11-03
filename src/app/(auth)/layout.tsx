import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Glow } from "@/components/ui/glow";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // Ambient backdrop for every auth screen. It lives here rather than
    // in each page so login / signup / forgot / reset stay visually
    // identical by construction. Two offset washes rather than one
    // centred blob — the overlap gives depth instead of looking like a
    // lamp pointed at the card.
    //
    // These pages own the accent for the whole app's first impression,
    // and they're seen once and briefly, so they can carry a flourish
    // the working screens can't.
    <div className="relative isolate min-h-screen overflow-hidden bg-background">
      <Glow className="-top-32 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2" />
      <Glow className="-right-24 -bottom-40 h-[26rem] w-[26rem]" />
      {children}
    </div>
  );
}
