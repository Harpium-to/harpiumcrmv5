"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Rail } from "@/components/layout/rail";
import { TopBar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { Glow } from "@/components/ui/glow";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Nav drawer state — only used on mobile. On lg+ the rail is always
  // visible and this stays at `false` (ignored by the component).
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    // One scroll container for the whole workspace. The rail floats
    // over it and the top bar sticks to it, so there is no nested
    // scroll region and no bordered frame — just the warm plane with
    // the chrome resting on top.
    <div className="relative isolate h-screen overflow-y-auto bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />

      {/* Ambient backdrop. `fixed` so it stays put while content
          scrolls past it, which is what makes it read as the room the
          workspace sits in rather than as an element on the page. */}
      <div
        aria-hidden
        data-print="hide"
        className="pointer-events-none fixed inset-0 -z-10"
      >
        <Glow className="-top-40 left-1/2 h-[34rem] w-[52rem] -translate-x-1/2" />
        <Glow className="right-[-10rem] bottom-[-12rem] h-[26rem] w-[26rem]" />
      </div>

      {/* The rail and the top bar are screen navigation; print drops
          them (see the @media print block in globals.css). */}
      <div data-print="hide">
        <Rail open={navOpen} onClose={closeNav} />
      </div>

      {/* The left padding is the rail's gutter: it only exists on lg+,
          where the rail is actually there to clear. */}
      <div className="lg:pl-[5.25rem]" data-print="flatten">
        <div data-print="hide">
          <TopBar onOpenNav={() => setNavOpen(true)} />
        </div>
        <main className="px-3 pt-2 pb-10 sm:px-4 sm:pb-14" data-print="flatten">
          {/* This one wrapper is what gives all ~20 dashboard routes
              an enter animation, with none of them opting in. */}
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
