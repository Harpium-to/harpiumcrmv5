"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { notificationTarget } from "@/lib/notifications/target";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { openHarpi } from "@/components/assistente/harpi";
import { notificationIcon } from "@/components/notifications/notification-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Notification } from "@/types";

/** How many the bell lists; the rest are one click away on the screen. */
const LATEST = 8;

/**
 * The bell in the top bar. Notificações used to take a whole row in
 * the menu, as if it were a place to work in; it is an alert, so it
 * lives up here with its count, on every screen and on the phone too.
 *
 * Opening it lists the latest few. Clicking one marks it read and goes
 * where the Notificações screen would go (`notificationTarget`).
 */
export function NotificationsBell() {
  const t = useTranslations("TopBar");
  const ts = useTranslations("Sidebar");
  const router = useRouter();
  const { accountId } = useAuth();
  const unread = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = useCallback(async () => {
    if (!accountId) {
      setItems([]);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(LATEST);
    // A failed read shows the empty list; the screen is one click away.
    setItems(error ? [] : ((data ?? []) as Notification[]));
  }, [accountId]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const pick = (n: Notification) => {
    setOpen(false);
    if (!n.read_at) {
      // The count follows on its own: useUnreadNotifications hears the
      // UPDATE through Realtime.
      void createClient()
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", n.id)
        .is("read_at", null);
    }
    const target = notificationTarget(n);
    if (target?.kind === "harpi") openHarpi({ view: "history" });
    else if (target) router.push(target.href);
  };

  const label =
    unread > 0
      ? `${t("notifications")} · ${ts("unreadNotifications", { count: unread })}`
      : t("notifications");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={label}
        className="relative flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground data-popup-open:bg-foreground/8"
      >
        <Bell className="size-5" />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-80 gap-1 p-1.5">
        <p className="px-2 pt-1 pb-0.5 text-sm font-medium text-foreground">
          {t("notifications")}
        </p>

        {items === null ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t("notificationsEmpty")}
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col overflow-y-auto">
            {items.map((n) => {
              const Icon = notificationIcon(n.type);
              const isUnread = !n.read_at;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => pick(n)}
                    className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-foreground/6"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                        isUnread ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          isUnread ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="block text-[11px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    </span>
                    {isUnread ? (
                      <span
                        aria-label={t("notificationsUnread")}
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-border pt-1">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-center text-sm font-medium text-foreground transition-colors hover:bg-foreground/6"
          >
            {t("notificationsSeeAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
