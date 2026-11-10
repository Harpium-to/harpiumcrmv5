// ============================================================
// Small formatting helpers for the panel, as pure functions.
//
// Loaded by content.js through a dynamic import, like chat-id.js.
// ============================================================

/**
 * A money amount as someone in Brazil types it, as a number — or null
 * when it is not one.
 *
 * "1.234,56", "1234,56", "1234.56", "R$ 4.800" and "4800" are all the
 * same kind of thing; "" is zero (the field is optional). The rule for
 * the ambiguous case: with a comma present, the comma is the decimal
 * mark and dots are thousands; without one, a dot followed by exactly
 * three digits is thousands ("4.800"), anything else is a decimal.
 */
export function parseMoney(text) {
  let value = String(text ?? "")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (value === "") return 0;
  if (!/^[\d.,]+$/.test(value)) return null;

  if (value.includes(",")) {
    if ((value.match(/,/g) || []).length > 1) return null;
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, "");
  } else if ((value.match(/\./g) || []).length > 1) {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  // The CRM keeps two decimals (NUMERIC(12,2)).
  return Math.round(number * 100) / 100;
}

/**
 * When something happened, the way a person would say it: "agora",
 * "há 5 min", "há 3 h", "ontem", "há 4 dias", and a date after a week.
 */
export function formatWhen(iso, now = Date.now()) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return new Date(time).toLocaleDateString("pt-BR");
}

/**
 * Add `name` to a list of tag names: trimmed, no duplicates whatever
 * the capitalisation, and nothing too long to be a tag. Returns the
 * same list when there is nothing to add.
 */
export function addTagName(names, name) {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 40) return names;
  const key = clean.toLocaleLowerCase("pt-BR");
  if (names.some((existing) => existing.toLocaleLowerCase("pt-BR") === key)) return names;
  return [...names, clean];
}
