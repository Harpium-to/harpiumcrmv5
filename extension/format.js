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

/**
 * A name that is only a phone number counts as no name: a contact
 * created from a message is called by its number until someone fixes
 * it, and "Olá 5531999998888" is worse than "Olá".
 */
function usableName(name) {
  const trimmed = String(name ?? "").trim();
  return /^[\d\s+().-]*$/.test(trimmed) ? "" : trimmed;
}

/**
 * Fill `{{nome}}`, `{{primeiro_nome}}` and `{{empresa}}` in a quick
 * reply from the contact. Returns `{ text, missing }`.
 *
 * A copy of `fillQuickReply` in src/lib/quick-replies/variables.ts —
 * the CRM's inbox runs that one, and a reply written once has to read
 * the same in both places. format.test.js keeps the two equal; the
 * reasoning behind each rule is written there, with the original.
 */
export function fillTemplate(text, contact) {
  const name = usableName(contact?.name);
  const values = {
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] ?? "",
    empresa: String(contact?.company ?? "").trim(),
  };
  const order = ["nome", "primeiro_nome", "empresa"];
  const missing = new Set();

  const filled = String(text ?? "").replace(
    /( ?)\{\{\s*(nome|primeiro_nome|empresa)\s*\}\}( ?)/gi,
    (match, before, key, after, offset, whole) => {
      const variable = key.toLowerCase();
      const value = values[variable];
      if (value) return `${before}${value}${after}`;

      missing.add(variable);
      const next = whole[offset + match.length] ?? "";
      if (before && after) return " ";
      if (before && (next === "" || next === "\n" || /[,.!?;:]/.test(next))) return "";
      return before || after;
    },
  );

  if (missing.size === 0) return { text: filled, missing: [] };

  const tidy = filled
    .split("\n")
    .map((line) => line.replace(/^[ \t]*[,;:][ \t]*/, "").replace(/^[ \t]+/, ""))
    .join("\n");
  return { text: tidy, missing: order.filter((v) => missing.has(v)) };
}

/** Lower case and without accents, so "ola" finds "Olá". */
function plain(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * The quick replies that match what was typed: every word of the query
 * somewhere in the title or the text. An empty query matches all.
 */
export function filterReplies(replies, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...(replies ?? [])];
  return (replies ?? []).filter((reply) => {
    const haystack = plain(`${reply?.title ?? ""} ${reply?.text ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}


/**
 * The deals that match what was typed in the board's search: every
 * word somewhere in the deal's title or its contact's name or phone.
 */
export function filterDeals(deals, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...(deals ?? [])];
  return (deals ?? []).filter((deal) => {
    const haystack = plain(
      `${deal?.title ?? ""} ${deal?.contact?.name ?? ""} ${deal?.contact?.phone ?? ""}`,
    );
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Deals laid out as board columns: one per stage of the pipeline, in
 * board order, each with its deals and what they add up to.
 *
 * `total` is null when the column mixes currencies — adding reais to
 * dollars gives a number that means nothing. A deal whose stage is not
 * one of the pipeline's (the stage was deleted) is not dropped: it
 * goes to a last column of its own, so it can still be seen and moved.
 */
export function boardColumns(stages, deals) {
  const columns = (stages ?? []).map((stage) => ({ stage, deals: [] }));
  const byStage = new Map(columns.map((column) => [column.stage.id, column]));
  const stray = [];
  for (const deal of deals ?? []) {
    const column = byStage.get(deal?.stage?.id);
    if (column) column.deals.push(deal);
    else stray.push(deal);
  }
  if (stray.length) columns.push({ stage: { id: null, name: "Sem etapa" }, deals: stray });

  return columns.map((column) => {
    const currencies = new Set(column.deals.map((deal) => deal.currency || "BRL"));
    const total =
      currencies.size === 1
        ? {
            currency: [...currencies][0],
            value: column.deals.reduce((sum, deal) => sum + (Number(deal.value) || 0), 0),
          }
        : null;
    return { ...column, total };
  });
}

/**
 * The digits to open a WhatsApp chat with, from a phone as the CRM
 * stores it — or null when it is not a full number. WhatsApp's own
 * link takes the number with country code and nothing else.
 */
export function chatPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/**
 * When a task is due, said the way a person would — "hoje às 14:00",
 * "amanhã às 09:00", "atrasada · ontem às 16:30" — with a tone:
 * "overdue", "today" or "later". Null for no date.
 *
 * A copy of `describeDue` in src/lib/tasks/due.ts: the CRM shows the
 * same tasks. format.test.js keeps the two saying the same thing.
 */
export function describeDue(dueAt, now = new Date()) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (!Number.isFinite(due.getTime())) return null;

  const two = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(due) - dayOf(now)) / 86_400_000);

  const time = `${two(due.getHours())}:${two(due.getMinutes())}`;
  const date =
    `${two(due.getDate())}/${two(due.getMonth() + 1)}` +
    (due.getFullYear() === now.getFullYear() ? "" : `/${due.getFullYear()}`);
  const day = days === 0 ? "hoje" : days === 1 ? "amanhã" : days === -1 ? "ontem" : date;
  const when = `${day} às ${time}`;

  if (due.getTime() < now.getTime()) return { label: `atrasada · ${when}`, tone: "overdue" };
  return { label: when, tone: days === 0 ? "today" : "later" };
}

/** How many open tasks are late or for today: the reminder count. */
export function countDueNow(tasks, now = new Date()) {
  return (tasks ?? []).filter((task) => {
    if (task?.done_at) return false;
    const due = describeDue(task?.due_at, now);
    return due !== null && due.tone !== "later";
  }).length;
}

/**
 * The value of a `datetime-local` field as an ISO date-time in UTC —
 * what the API takes — or null for an empty or unreadable field. The
 * field is in the person's own time zone, and so is `new Date()` of
 * its value.
 */
export function localInputToIso(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
