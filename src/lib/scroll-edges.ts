/**
 * Which ends of a horizontally scrolling strip have content cut off.
 * Pure, so "does the arrow show at exactly the end?" is a test.
 * A pixel or two of slack absorbs sub-pixel layout rounding.
 */
export function scrollEdges(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  slack = 2,
): { left: boolean; right: boolean } {
  if (scrollWidth - clientWidth <= slack) return { left: false, right: false };
  return {
    left: scrollLeft > slack,
    right: scrollLeft + clientWidth < scrollWidth - slack,
  };
}
