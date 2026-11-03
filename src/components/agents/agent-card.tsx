"use client";

import { useTranslations } from "next-intl";
import { Check, Copy, Crown, Loader2, Maximize2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentFace } from "./agent-face";
import { roleLabelKey } from "@/lib/agents/roles";
import { compactAgo } from "./format";
import type { Agent } from "@/lib/agents/types";

interface AgentCardProps {
  agent: Agent;
  /** Lifetime replies by this agent. */
  handled: number;
  /** ISO timestamp of its most recent run, or undefined if it never ran. */
  lastRun?: string;
  /** True while this agent has a run in flight. */
  working: boolean;
  /** Admins can switch and edit; everyone else reads. */
  canEdit: boolean;
  /** True while a toggle request is in flight — disables the switch. */
  pending?: boolean;
  /** True while this agent is being copied. */
  duplicating?: boolean;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
}

/**
 * One agent, as a switchable appliance.
 *
 * The design borrows its on/off grammar from a device panel, and that
 * is the honest metaphor: an agent is a thing that is either answering
 * your customers or it isn't, and that state matters more than any
 * other property on the card. So "on" is not a small toggle in the
 * corner — the whole surface goes solid and warm, and an off agent
 * recedes into the page. You can tell who is on duty from across the
 * room, without reading a word.
 *
 * The explicit X / ✓ pair rather than a sliding switch is deliberate
 * too: switching an agent on points it at live customers, and a
 * two-target control is much harder to flip by accident than a toggle
 * that activates anywhere along its track.
 */
export function AgentCard({
  agent,
  handled,
  lastRun,
  working,
  canEdit,
  pending = false,
  duplicating = false,
  onToggle,
  onEdit,
  onDuplicate,
}: AgentCardProps) {
  const t = useTranslations("Agents");
  const on = agent.isActive;
  // Never build a translation key by concatenating a free-text column.
  const roleKey = roleLabelKey(agent.role);

  return (
    <article
      data-on={on}
      className={cn(
        "group relative flex flex-col rounded-2xl p-5 transition-colors duration-300",
        on ? "surface-on" : "surface",
      )}
    >
      <div className="flex items-start gap-3">
        {/* The halo only ever plays while a run is open, so motion on
            this screen always means a real customer is being answered. */}
        <AgentFace
          agent={agent}
          working={working}
          className={cn(
            "size-11 shrink-0",
            on
              ? "bg-primary-foreground/12 text-primary-foreground"
              : "bg-foreground/8 text-muted-foreground",
          )}
        />

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "flex items-center gap-1.5 truncate font-medium",
              on ? "text-primary-foreground" : "text-foreground",
            )}
          >
            <span className="truncate">{agent.name}</span>
            {agent.isFallback ? (
              <Crown
                className="size-3.5 shrink-0 opacity-60"
                aria-label={t("formFallback")}
              />
            ) : null}
          </h3>
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-sm",
              on ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {working ? (
              <>
                <span>{t("working")}</span>
                <span className="fx-blink flex items-center gap-0.5" aria-hidden>
                  <span className="size-1 rounded-full bg-current" />
                  <span className="size-1 rounded-full bg-current" />
                  <span className="size-1 rounded-full bg-current" />
                </span>
              </>
            ) : (
              <span className="truncate">
                {roleKey ? t(roleKey) : agent.department}
              </span>
            )}
          </p>
        </div>

        {/* Switch pair. Hidden from non-admins entirely rather than
            shown disabled — a control you can never use is noise. */}
        {canEdit ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full p-1",
              on ? "bg-primary-foreground/12" : "bg-foreground/8",
            )}
            role="group"
            aria-label={agent.name}
          >
            <button
              type="button"
              onClick={() => onToggle(false)}
              disabled={pending || !on}
              aria-label={t("turnOff")}
              aria-pressed={!on}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors disabled:cursor-default",
                !on
                  ? "bg-foreground/15 text-foreground"
                  : "text-primary-foreground/60 hover:text-primary-foreground",
              )}
            >
              <X className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onToggle(true)}
              disabled={pending || on}
              aria-label={t("turnOn")}
              aria-pressed={on}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors disabled:cursor-default",
                on
                  ? "bg-primary-foreground text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Check className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Routing rules. The card says not just who this agent is but
          what pulls a conversation to it — the question an operator
          actually has when a message went to the wrong place. */}
      <div className="mt-4 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
            on
              ? "bg-primary-foreground/12 text-primary-foreground/80"
              : "bg-foreground/8 text-muted-foreground",
          )}
          title={t(`autonomy${agent.autonomy}Desc`)}
        >
          <span className="tabular-nums opacity-60">{agent.autonomy}</span>
          {t(`autonomy${agent.autonomy}`)}
        </span>
        {agent.objective ? (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              on ? "text-primary-foreground/60" : "text-muted-foreground",
            )}
          >
            {agent.objective}
          </span>
        ) : null}
      </div>

      {agent.keywords.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {agent.keywords.slice(0, 6).map((kw) => (
            <li
              key={kw}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs",
                on
                  ? "bg-primary-foreground/12 text-primary-foreground/80"
                  : "bg-foreground/8 text-muted-foreground",
              )}
            >
              {kw}
            </li>
          ))}
          {agent.keywords.length > 6 ? (
            <li
              className={cn(
                "rounded-full px-2.5 py-1 text-xs tabular-nums",
                on
                  ? "text-primary-foreground/60"
                  : "text-muted-foreground opacity-70",
              )}
            >
              +{agent.keywords.length - 6}
            </li>
          ) : null}
        </ul>
      ) : null}

      <div
        className={cn(
          "mt-auto flex items-center gap-3 pt-5 text-xs",
          on ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        <span className="tabular-nums">{t("handledCount", { count: handled })}</span>
        <span aria-hidden>·</span>
        <span className="truncate">
          {lastRun ? t("lastRun", { when: compactAgo(lastRun) }) : t("neverRan")}
        </span>
      </div>

      {/* Edit and copy, in the corner the reference puts its expand
          control. They appear on hover/focus so a wall of cards stays
          calm, but stay reachable by keyboard at all times.
          Deliberately not next to the on/off pair: copying is a build
          action, switching is an operational one, and a clone button
          one pixel from the control that points an agent at live
          customers is a misclick waiting to happen. */}
      {canEdit ? (
        <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onDuplicate}
            disabled={duplicating}
            aria-label={`${t("duplicate")} — ${agent.name}`}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              on
                ? "text-primary-foreground/60 hover:bg-primary-foreground/12"
                : "text-muted-foreground hover:bg-foreground/8",
            )}
          >
            {duplicating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${t("edit")} — ${agent.name}`}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              on
                ? "text-primary-foreground/60 hover:bg-primary-foreground/12"
                : "text-muted-foreground hover:bg-foreground/8",
            )}
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      ) : null}
    </article>
  );
}
