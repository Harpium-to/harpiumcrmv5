import { describe, expect, it } from "vitest";
import {
  HANDOFF_LATE_MINUTES,
  formatWait,
  waitInfo,
  waitingFirst,
} from "./handoff-wait";

const NOW = Date.parse("2026-11-09T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("waitInfo", () => {
  it("is not waiting without a timestamp", () => {
    expect(waitInfo(null, NOW)).toEqual({ waiting: false, minutes: 0, late: false });
    expect(waitInfo(undefined, NOW).waiting).toBe(false);
    expect(waitInfo("not a date", NOW).waiting).toBe(false);
  });

  it("counts whole minutes and turns late at the threshold", () => {
    expect(waitInfo(minutesAgo(3), NOW)).toEqual({ waiting: true, minutes: 3, late: false });
    expect(waitInfo(minutesAgo(HANDOFF_LATE_MINUTES - 1), NOW).late).toBe(false);
    expect(waitInfo(minutesAgo(HANDOFF_LATE_MINUTES), NOW).late).toBe(true);
  });

  it("never goes negative when the browser clock is behind", () => {
    expect(waitInfo(minutesAgo(-2), NOW)).toEqual({ waiting: true, minutes: 0, late: false });
  });
});

describe("formatWait", () => {
  it.each([
    [0, "agora"],
    [1, "1 min"],
    [59, "59 min"],
    [60, "1 h"],
    [65, "1 h 05 min"],
    [180, "3 h"],
    [24 * 60, "1 dia"],
    [3 * 24 * 60 + 5, "3 dias"],
  ])("%i minutes → %s", (minutes, text) => {
    expect(formatWait(minutes)).toBe(text);
  });
});

describe("waitingFirst", () => {
  it("returns the same array when nobody waits", () => {
    const list = [{ id: "a", needs_human_since: null }, { id: "b" }];
    expect(waitingFirst(list)).toBe(list);
  });

  it("puts the longest wait on top and keeps the rest in order", () => {
    const list = [
      { id: "recent", needs_human_since: null },
      { id: "waiting-2m", needs_human_since: minutesAgo(2) },
      { id: "older", needs_human_since: null },
      { id: "waiting-30m", needs_human_since: minutesAgo(30) },
    ];
    expect(waitingFirst(list).map((c) => c.id)).toEqual([
      "waiting-30m",
      "waiting-2m",
      "recent",
      "older",
    ]);
  });
});
