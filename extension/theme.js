// ============================================================
// Whether the page behind the panel is light or dark, as pure
// functions.
//
// WhatsApp Web has its own theme setting, which may disagree with the
// operating system's — so `prefers-color-scheme` alone would put a
// dark panel beside a light WhatsApp, or the other way around. The
// panel instead looks at the colour WhatsApp actually painted, which
// needs no knowledge of its class names.
//
// Loaded by content.js through a dynamic import, like chat-id.js.
// ============================================================

/**
 * True for a dark colour, false for a light one, null when the string
 * says nothing: transparent, or a format this doesn't read.
 *
 * Reads what `getComputedStyle` returns in Chrome: `rgb(r, g, b)`,
 * `rgba(r, g, b, a)`, and `color(srgb r g b / a)` for colours written
 * in the newer syntaxes.
 */
export function isDarkColor(cssColor) {
  const value = typeof cssColor === "string" ? cssColor.trim() : "";
  let channels = null;
  let alpha = 1;

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (rgb) {
    channels = [rgb[1], rgb[2], rgb[3]].map((c) => Number(c) / 255);
    alpha = readAlpha(rgb[4]);
  } else if (srgb) {
    channels = [srgb[1], srgb[2], srgb[3]].map(Number);
    alpha = readAlpha(srgb[4]);
  }
  if (!channels || channels.some((c) => !Number.isFinite(c))) return null;
  // A see-through background is whatever lies under it, not this.
  if (alpha < 0.5) return null;

  const [r, g, b] = channels.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.3;
}

function readAlpha(raw) {
  if (raw === undefined) return 1;
  const number = Number.parseFloat(raw);
  if (!Number.isFinite(number)) return 1;
  return raw.endsWith("%") ? number / 100 : number;
}

/**
 * "dark" or "light" for the panel: the first background colour that
 * says something decides; when none does, the system preference.
 */
export function pickMode(backgroundColors, prefersDark) {
  for (const color of backgroundColors ?? []) {
    const dark = isDarkColor(color);
    if (dark !== null) return dark ? "dark" : "light";
  }
  return prefersDark ? "dark" : "light";
}
