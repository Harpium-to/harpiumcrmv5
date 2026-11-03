"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAgentActivity } from "@/hooks/use-agent-activity";

/**
 * The live agent indicator in the top bar.
 *
 * Present on every screen on purpose: an autonomous responder that
 * only shows its state on its own settings page is a thing you have to
 * remember to go and check. Here, "two agents are mid-reply right now"
 * is ambient — and one click away from the monitor that says which.
 *
 * Renders nothing until the first fetch resolves, so a workspace with
 * no agents never shows an empty chip.
 */
export function AgentPulseChip({ className }: { className?: string }) {
  const t = useTranslations("TopBar");
  // Small backfill: this only needs to know what is *currently*
  // running, not the history the monitor shows.
  const { runs, running } = useAgentActivity({
    limit: 20,
    channelName: "agent-pulse",
  });

  if (runs === null || runs.length === 0) return null;

  const busy = running > 0;

  return (
    <Link
      href="/agents?tab=live"
      aria-label={busy ? t("agentsWorking", { count: running }) : t("agentsIdle")}
      className={cn(
        "chip h-10 px-3.5 text-sm",
        busy && "text-foreground",
        className,
      )}
      data-active={busy}
    >
      <Bot className="size-4" />
      {busy ? (
        <>
          <span className="tabular-nums">{running}</span>
          {/* The three dots do the work the number can't: they say the
              count is live, not a total for the day. */}
          <span className="fx-blink flex items-center gap-0.5" aria-hidden>
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
          </span>
        </>
      ) : null}
    </Link>
  );
}
