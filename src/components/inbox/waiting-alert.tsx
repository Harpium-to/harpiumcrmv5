"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hand } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useWaitingConversations } from "@/hooks/use-waiting-conversations";
import { formatWait, waitInfo } from "@/lib/inbox/handoff-wait";

/**
 * Floating call to action on every dashboard screen while a
 * conversation the AI handed off has no answer yet. Amber while
 * waiting, red and pulsing once the wait is late.
 *
 * Not drawn in the inbox: there the list pins those conversations on
 * top with the same colours, and a floating box would cover the
 * composer's send button.
 */
export function WaitingAlert() {
  const t = useTranslations("Handoff");
  const pathname = usePathname();
  const { items, lateCount, now } = useWaitingConversations();

  if (items.length === 0 || pathname?.startsWith("/inbox")) return null;

  const oldest = items[0];
  const wait = waitInfo(oldest.since, now);
  const late = lateCount > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-end sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      <Link
        href={`/inbox?c=${oldest.id}`}
        className={cn(
          "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 shadow-lg ring-1 transition-transform hover:-translate-y-0.5 sm:w-auto",
          late
            ? "bg-red-600 text-white ring-red-700/40"
            : "bg-amber-400 text-amber-950 ring-amber-500/50",
        )}
      >
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-black/10">
          {late && (
            <span className="absolute inset-0 animate-ping rounded-full bg-white/40" aria-hidden />
          )}
          <Hand className="relative size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">
            {t("alertTitle", { count: items.length })}
          </span>
          <span className="block truncate text-xs opacity-90">
            {wait.minutes < 1
              ? t("alertOldestNow", { name: oldest.contactName ?? t("someone") })
              : t("alertOldest", {
                  name: oldest.contactName ?? t("someone"),
                  time: formatWait(wait.minutes),
                })}
            {late ? ` · ${t("late")}` : ""}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
            late ? "bg-white text-red-700" : "bg-amber-950 text-amber-50",
          )}
        >
          {t("answer")}
        </span>
      </Link>
    </div>
  );
}
