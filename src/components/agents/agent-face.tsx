"use client";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AGENT_ICONS, FALLBACK_AGENT_ICON } from "./agent-icon";
import type { Agent } from "@/lib/agents/types";

interface AgentFaceProps {
  agent: Pick<Agent, "name" | "role" | "department" | "avatarUrl">;
  /** The circle itself — size and colour belong to whoever places it. */
  className?: string;
  iconClassName?: string;
  /** Plays the breathing halo. Only ever true while a run is open. */
  working?: boolean;
}

/**
 * An agent's face: its uploaded picture, or the icon for its job.
 *
 * One component rather than the same ternary in the team card, the
 * operation floor and the network view — and more than a convenience,
 * because the fallback has to be the *role* icon and not initials.
 * Initials are how you tell two people apart; a glance at this screen
 * is asking which station is running, so an unphotographed closer
 * should still look like a closer.
 *
 * Built on the Avatar primitive so a dead storage URL falls back to
 * that icon instead of a broken-image glyph. The primitive's hairline
 * ring is suppressed: the coloured circle underneath already draws the
 * edge, and on a lit card the two read as a double outline.
 */
export function AgentFace({
  agent,
  className,
  iconClassName,
  working = false,
}: AgentFaceProps) {
  const Icon =
    AGENT_ICONS[agent.role] ??
    AGENT_ICONS[agent.department] ??
    FALLBACK_AGENT_ICON;

  return (
    <Avatar
      className={cn(
        "items-center justify-center after:hidden",
        className,
        working && "fx-halo",
      )}
    >
      {agent.avatarUrl ? (
        <AvatarImage src={agent.avatarUrl} alt={agent.name} />
      ) : null}
      <AvatarFallback className="bg-transparent text-current">
        <Icon className={cn("size-5", iconClassName)} />
      </AvatarFallback>
    </Avatar>
  );
}
