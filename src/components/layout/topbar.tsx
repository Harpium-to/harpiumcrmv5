"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { LogOut, Menu, Puzzle, Settings as SettingsIcon, User, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { activeNavItem, NAV_SECTIONS } from "@/lib/nav";
import { PillNav, type PillItem } from "@/components/ui/pill-nav";
import { AgentPulseChip } from "@/components/agents/agent-pulse-chip";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { PageHelp } from "@/components/help/page-help";
import { CrmMenuItems } from "@/components/layout/crm-menu-items";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TopBarProps {
  /** Opens the mobile nav drawer the rail renders. */
  onOpenNav?: () => void;
}

/**
 * The floating top bar: brand on the left, the current screen's
 * sections in the middle, live status and the account on the right.
 *
 * It is a pill that floats over the workspace rather than a bar that
 * divides it — paired with the icon rail, that is what keeps the warm
 * backdrop reading as one continuous plane instead of three boxed-off
 * regions. Nothing here scrolls away: it is `sticky`, so the sections
 * and the agent pulse stay reachable from the bottom of a long list.
 */
export function TopBar({ onOpenNav }: TopBarProps) {
  const t = useTranslations("Sidebar");
  const tb = useTranslations("TopBar");
  const pathname = usePathname();
  const { profile, account, signOut } = useAuth();
  const brand = useBrand();

  const current = activeNavItem(pathname);
  const sections = current ? NAV_SECTIONS[current.href] : undefined;

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <div className="sticky top-0 z-20 px-3 pt-3 pb-1 sm:px-4 sm:pt-4">
      <div className="surface surface-blur flex items-center gap-2 rounded-full p-2 sm:gap-3">
        {/* ---- Left: nav toggle (mobile) + brand ---- */}
        <button
          type="button"
          onClick={onOpenNav}
          aria-label={tb("openMenu")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>

        <Link
          href="/dashboard"
          className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full pr-2 pl-1 transition-opacity hover:opacity-80"
        >
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <span className="text-sm font-semibold">
                {(brand.name || t("title")).charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm font-medium text-foreground xl:block">
            {brand.name || t("title")}
          </span>
        </Link>

        {/* ---- Centre: this screen's sections, or its name ---- */}
        <div className="flex min-w-0 flex-1 justify-center">
          {sections && current ? (
            <Suspense
              fallback={
                <p className="truncate text-sm text-muted-foreground">
                  {t(current.labelKey)}
                </p>
              }
            >
              <SectionTrack
                href={current.href}
                items={sections.map((s) => ({
                  value: s.value,
                  label: tb(s.labelKey),
                  icon: s.icon,
                  href: `${current.href}?tab=${s.value}`,
                }))}
                fallbackValue={sections[0]!.value}
              />
            </Suspense>
          ) : (
            <p className="truncate text-sm font-medium text-foreground">
              {current ? t(current.labelKey) : t("dashboard")}
            </p>
          )}
        </div>

        {/* ---- Right: live status + account ---- */}
        <div className="flex shrink-0 items-center gap-2">
          <AgentPulseChip className="hidden sm:inline-flex" />
          {/* Ferramentas: the extra tools of the CRM (quiz e formulários
              first). Beside the agents chip; on a phone it is in the
              menu drawer instead. */}
          <Link
            href="/ferramentas"
            aria-label={t("tools")}
            data-active={pathname === "/ferramentas" || pathname.startsWith("/ferramentas/")}
            className="chip hidden h-10 px-3.5 text-sm sm:inline-flex"
          >
            <Wrench className="size-4" />
            <span className="hidden xl:inline">{t("tools")}</span>
          </Link>
          <PageHelp />
          <ModeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={tb("openAccountMenu")}
              className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 transition-colors hover:bg-foreground/8 focus:outline-none data-popup-open:bg-foreground/8 sm:pl-3"
            >
              <span className="hidden min-w-0 text-right sm:block">
                <span className="block truncate text-sm font-medium text-foreground">
                  {account?.name ?? profile?.full_name ?? tb("defaultUser")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </span>
              </span>
              <Avatar className="size-9">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? tb("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-primary text-sm font-medium text-primary-foreground">
                  {initial}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={10}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? tb("defaultUser")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
              <DropdownMenuSeparator className="bg-border" />
              <CrmMenuItems />
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {tb("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=extensao"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Puzzle className="size-4" />
                {tb("menuExtension")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <SettingsIcon className="size-4" />
                {tb("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {tb("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/**
 * The pill track itself. Split out so the `useSearchParams` read sits
 * behind the Suspense boundary Next requires for it, rather than
 * forcing the whole bar to suspend.
 */
function SectionTrack({
  items,
  fallbackValue,
  className,
}: {
  href: string;
  items: PillItem[];
  fallbackValue: string;
  className?: string;
}) {
  const params = useSearchParams();
  const tab = params.get("tab");
  const value = items.some((i) => i.value === tab) ? tab! : fallbackValue;

  return (
    <PillNav
      items={items}
      value={value}
      className={cn("max-w-full overflow-x-auto", className)}
    />
  );
}
