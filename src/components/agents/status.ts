import type { AgentStatus } from "@/lib/agents/types";

/**
 * Status → how a card reads.
 *
 * Nine states is a lot, and that is the point: "trabalhando" and
 * "aguardando aprovação" look identical in a two-state system, and the
 * second one is the one that needs somebody. Colour separates the
 * three groups — working (accent), waiting on someone (amber), broken
 * (red) — so a wall of agents is scannable before any label is read.
 *
 * Shared by the operation floor and the network view: the same state
 * has to look the same on both, or switching between them reads as two
 * different systems.
 */
export const STATUS_TONE: Record<AgentStatus, string> = {
  idle: "text-muted-foreground",
  working: "text-primary",
  researching: "text-primary",
  talking: "text-primary",
  analyzing: "text-primary",
  waiting_reply: "text-amber-400",
  waiting_approval: "text-amber-400",
  paused: "text-muted-foreground",
  error: "text-destructive",
};

/** The states that mean the agent is mid-action right now. */
export const BUSY: AgentStatus[] = [
  "working",
  "researching",
  "talking",
  "analyzing",
];

export function statusLabelKey(status: AgentStatus): string {
  // idle → statusIdle, waiting_reply → statusWaitingReply
  const camel = status
    .split("_")
    .map((part, i) =>
      i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
  return `status${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}
