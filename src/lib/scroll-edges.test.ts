import { describe, expect, it } from "vitest";

import { scrollEdges } from "./scroll-edges";

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
