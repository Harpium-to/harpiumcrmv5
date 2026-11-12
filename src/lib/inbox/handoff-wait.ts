import type { Conversation } from "@/types";

/**
 * Conversations the AI handed to the team that no person has answered
 * yet (`conversations.needs_human_since`, migration 058).
 *
 * The database sets the timestamp at handoff and clears it when a
 * person writes to the customer, the AI is resumed or the
 * conversation is closed. Everything here only reads it.
 */

/** Past this many minutes without an answer, the wait shows as late. */
export const HANDOFF_LATE_MINUTES = 10;

export interface WaitInfo {
  waiting: boolean;
  /** Whole minutes since the handoff (0 when not waiting). */
  minutes: number;
  /** Waiting for longer than {@link HANDOFF_LATE_MINUTES}. */
  late: boolean;
}

const NOT_WAITING: WaitInfo = { waiting: false, minutes: 0, late: false };

export function waitInfo(
  needsHumanSince: string | null | undefined,
  now: number,
): WaitInfo {
  if (!needsHumanSince) return NOT_WAITING;
  const since = Date.parse(needsHumanSince);
  if (!Number.isFinite(since)) return NOT_WAITING;
  // A clock a little behind the database would show a negative wait.
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  return { waiting: true, minutes, late: minutes >= HANDOFF_LATE_MINUTES };
}

/** "agora", "4 min", "1 h 05 min", "3 h", "2 dias". */
export function formatWait(minutes: number): string {
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
  }
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? "1 dia" : `${days} dias`;
}

/**
 * Waiting conversations first, the longest wait on top; the rest keep
 * their order. Stable, and returns the same array when nothing waits
 * so memoised lists don't re-render for nothing.
 */
export function waitingFirst<T extends Pick<Conversation, "needs_human_since">>(
  conversations: T[],
): T[] {
  if (!conversations.some((c) => c.needs_human_since)) return conversations;
  const waiting = conversations
    .filter((c) => c.needs_human_since)
    .sort(
      (a, b) =>
        Date.parse(a.needs_human_since as string) -
        Date.parse(b.needs_human_since as string),
    );
  const rest = conversations.filter((c) => !c.needs_human_since);
  return [...waiting, ...rest];
}
