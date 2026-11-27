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

/**
 * How far to scroll a strip so an item is fully in view, leaving
 * `room` px for the arrow on that side. 0 when it already is.
 */
export function revealDelta(
  track: { left: number; right: number },
  item: { left: number; right: number },
  room = 40,
): number {
  if (item.left < track.left) return item.left - track.left - room;
  if (item.right > track.right) return item.right - track.right + room;
  return 0;
}
