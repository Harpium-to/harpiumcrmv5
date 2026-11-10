// ============================================================
// Where the shortcut bar goes in WhatsApp's chat header.
//
// Pure, so it is tested (shortcuts.test.js). Loaded by content.js
// through a dynamic import, like chat-id.js.
//
// The bar is not put inside WhatsApp's page — it re-renders the header
// at will, and a foreign node there breaks or vanishes. It floats over
// the empty stretch of the header instead: right of the contact's
// name, left of WhatsApp's own buttons. What the header looked like in
// November 2026: one wide button (the name, "Informações de contato")
// from the avatar to about two thirds of the way, then 40px icon
// buttons. Its text ends well before that wide button does, and that
// empty end is where the bar sits.
//
// When it doesn't fit, it gives up its last buttons, down to a
// minimum; below that it hides. Never on top of a word or a button.
// With the panel open, the chat header is usually too narrow (measured
// on 10/11/2026: 79px between the text and the buttons) — and the
// panel itself is then on screen with all of it.
// ============================================================

/** Width of one shortcut, its padding and the gaps, in px. */
export const SHORTCUT_SIZE = 34;
const BAR_PADDING = 4;
const GAP = 12;
const BAR_HEIGHT = 36;

/**
 * @param {object} m  Measurements of the header, in viewport px.
 * @param {{left: number, right: number, top: number, height: number}} m.header
 * @param {number} m.nameRight     Where the header's text ends.
 * @param {number} m.actionsLeft   Where WhatsApp's own buttons start.
 * @param {number} m.want          How many shortcuts there are.
 * @param {number} [m.min]         Fewer than this is no bar at all.
 * @returns {{left: number, top: number, count: number} | null}
 */
export function placeShortcuts({ header, nameRight, actionsLeft, want, min = 3 }) {
  if (!header || !(header.right > header.left) || !(want > 0)) return null;
  const right = Math.min(actionsLeft, header.right) - GAP;
  const leftBound = Math.max(nameRight, header.left) + GAP;
  const room = right - leftBound - BAR_PADDING * 2;
  const count = Math.min(want, Math.floor(room / SHORTCUT_SIZE));
  if (!Number.isFinite(count) || count < Math.min(min, want)) return null;
  const width = count * SHORTCUT_SIZE + BAR_PADDING * 2;
  return {
    left: Math.round(right - width),
    top: Math.round(header.top + (header.height - BAR_HEIGHT) / 2),
    count,
  };
}

/**
 * The header's measurements from what the page shows: the boxes of its
 * buttons and of its text. Pure: content.js reads the boxes.
 *
 * - WhatsApp's own buttons are the small ones (at most 64px wide) in
 *   the right half; the wide name button is not one of them.
 * - The text that counts is what ends before those buttons: a label
 *   further right is a hidden tooltip, not something on screen.
 *
 * @param {{left: number, right: number}} header
 * @param {{left: number, right: number, width: number}[]} buttons
 * @param {{left: number, right: number}[]} texts
 */
export function measureHeader(header, buttons, texts) {
  const middle = header.left + (header.right - header.left) / 2;
  const own = (buttons ?? []).filter((b) => b.width > 0 && b.width <= 64 && b.left >= middle);
  const actionsLeft = own.length ? Math.min(...own.map((b) => b.left)) : header.right;
  const before = (texts ?? []).filter((t) => t.right <= actionsLeft && t.right > t.left);
  const nameRight = before.length ? Math.max(...before.map((t) => t.right)) : header.left;
  return { nameRight, actionsLeft };
}
