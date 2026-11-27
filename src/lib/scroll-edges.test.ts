import { describe, expect, it } from "vitest";

import { revealDelta, scrollEdges } from "./scroll-edges";

describe("scrollEdges", () => {
  it("shows nothing when everything fits", () => {
    expect(scrollEdges(0, 700, 714)).toEqual({ left: false, right: false });
    expect(scrollEdges(0, 715, 714)).toEqual({ left: false, right: false });
  });

  it("points right at the start, both ways in the middle, left at the end", () => {
    expect(scrollEdges(0, 964, 714)).toEqual({ left: false, right: true });
    expect(scrollEdges(100, 964, 714)).toEqual({ left: true, right: true });
    expect(scrollEdges(250, 964, 714)).toEqual({ left: true, right: false });
    expect(scrollEdges(249.5, 964, 714)).toEqual({ left: true, right: false });
  });
});

describe("revealDelta", () => {
  const track = { left: 271, right: 985 };

  it("leaves an item that is fully in view alone", () => {
    expect(revealDelta(track, { left: 400, right: 500 })).toBe(0);
  });

  it("scrolls right past the arrow for an item cut on the right", () => {
    // The production case: Ajustes at 929–1032 under a 271–985 bar.
    expect(revealDelta(track, { left: 929, right: 1032 })).toBe(1032 - 985 + 40);
  });

  it("scrolls left for an item cut on the left", () => {
    expect(revealDelta(track, { left: 250, right: 340 })).toBe(250 - 271 - 40);
  });
});
