"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from "@/lib/nav";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

interface RailProps {
  /** Mobile drawer state, owned by the shell and opened from the top bar. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * Primary navigation.
 *
 * Desktop: a floating icon rail pinned to the left gutter. At rest it
 * is icons only — a 3.75rem column instead of a 15rem panel, which is
 * what buys the content area its full-bleed, poster-like top edge.
 * Pointing at it (or tabbing into it) widens it sideways to show every
 * label at once, over the content rather than pushing it, so nothing
 * on the page moves. The rail floats clear of the page edges (it is a
 * `.surface` pill, not a bordered column) so the warm backdrop reads
 * as one continuous plane behind the whole workspace.
 *
 * The expansion is CSS only (`group/rail` hover + keyboard focus), so
 * it can't get stuck open. It keys on `:focus-visible`, not `:focus`:
 * a mouse click leaves focus on the link, and the rail must still
 * close when the pointer leaves.
 *
 * Mobile: the same list as a labelled drawer — hover doesn't exist on
 * touch, so an icon-only rail there would be a guessing game.
 */

/** Applied to whatever should change while the desktop rail is open. */
const RAIL_OPEN_SHOW =
  "group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100";
const RAIL_OPEN_HIDE =
  "group-hover/rail:opacity-0 group-has-[:focus-visible]/rail:opacity-0";
export function Rail({ open = false, onClose }: RailProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  // Opened to go somewhere — once they pick, get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this; onClose identity shouldn't re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock scroll + Escape-to-close while the drawer is up. No-ops on
  // desktop, where `open` stays false.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  function isActive(item: NavItem) {
    return item.href === "/dashboard"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  /** Unread signal for the two routes that carry one. */
  function badgeFor(item: NavItem): number {
    if (item.href === "/inbox") return totalUnread;
    if (item.href === "/notifications") return unreadNotifications;
    return 0;
  }

  return (
    <>
      {/* ---- Desktop rail ---- */}
      <nav
        aria-label="Primary"
        className="group/rail fixed top-1/2 left-3 z-30 hidden -translate-y-1/2 lg:block"
      >
        {/* The radius is half the resting width, so at rest this is the
            same pill `rounded-full` drew — and stays a rounded card,
            not a giant capsule, once it widens. */}
        <div
          className={cn(
            "surface surface-blur flex max-h-[calc(100vh-2rem)] w-[3.75rem] flex-col gap-1 overflow-x-hidden overflow-y-auto rounded-[1.875rem] px-2 py-3",
            "transition-[width] duration-200 ease-out [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "group-hover/rail:w-56 group-has-[:focus-visible]/rail:w-56",
          )}
        >
          {NAV_GROUPS.map((group, groupIndex) => {
            const items = NAV_ITEMS.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="flex flex-col gap-1">
                {groupIndex > 0 ? (
                  <span
                    aria-hidden
                    className="mx-3 my-1 h-px shrink-0 bg-foreground/10"
                  />
                ) : null}
                {items.map((item) => {
                  const active = isActive(item);
                  const badge = badgeFor(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-label={t(item.labelKey)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 shrink-0 items-center rounded-full transition-colors",
                        active
                          ? "surface-on"
                          : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
                      )}
                    >
                      {/* Fixed square: the icon must not drift while
                          the rail's width animates around it. */}
                      <span className="relative flex size-11 shrink-0 items-center justify-center">
                        <item.icon className="size-[1.15rem]" />
                        {badge > 0 && !active ? (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background transition-opacity",
                              RAIL_OPEN_HIDE,
                            )}
                          />
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 pr-3 text-sm whitespace-nowrap opacity-0 transition-opacity duration-150",
                          RAIL_OPEN_SHOW,
                        )}
                      >
                        <span className="flex-1 truncate">
                          {t(item.labelKey)}
                        </span>
                        {item.beta ? (
                          <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase">
                            {t("beta")}
                          </span>
                        ) : null}
                        {badge > 0 ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 text-[11px] font-medium tabular-nums",
                              active
                                ? "bg-primary-foreground/15"
                                : "bg-primary text-primary-foreground",
                            )}
                          >
                            {badge > 99 ? "99+" : badge}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </nav>

      {/* ---- Mobile drawer ---- */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />
      <aside
        aria-label="Primary"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-3 left-3 z-50 flex w-64 flex-col rounded-3xl bg-card p-3 ring-1 ring-foreground/10",
          "transition-transform duration-200 ease-out will-change-transform lg:hidden",
          open ? "translate-x-0" : "-translate-x-[110%]",
        )}
      >
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
        <ul className="mt-1 flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            const badge = badgeFor(item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-full px-4 py-3 text-sm transition-colors",
                    active
                      ? "surface-on"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="size-[1.15rem]" />
                  <span className="flex-1">{t(item.labelKey)}</span>
                  {item.beta ? (
                    <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase">
                      {t("beta")}
                    </span>
                  ) : null}
                  {badge > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] font-medium tabular-nums",
                        active
                          ? "bg-primary-foreground/15"
                          : "bg-primary text-primary-foreground",
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
}
