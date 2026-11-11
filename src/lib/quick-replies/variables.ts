// ============================================================
// Variables in a quick reply: `{{nome}}`, `{{primeiro_nome}}` and
// `{{empresa}}`, filled from the contact when the reply is inserted.
//
// Pure, so the same rule runs in the inbox composer and — as a copy in
// extension/format.js, kept equal by a test — in the Chrome extension.
// A reply written once must read the same wherever it is used.
// ============================================================

/** The variables a quick reply may use, as written between `{{ }}`. */
export const QUICK_REPLY_VARIABLES = ['nome', 'primeiro_nome', 'empresa'] as const;
export type QuickReplyVariable = (typeof QUICK_REPLY_VARIABLES)[number];

export interface QuickReplyContact {
  name?: string | null;
  company?: string | null;
}

export interface FilledQuickReply {
  text: string;
  /** Variables the text uses that the contact has no value for. */
  missing: QuickReplyVariable[];
}

/**
 * A contact created from a message has its phone number as its name
 * until someone fixes it. "Olá 5531999998888" is worse than "Olá", so
 * a name that is only a number counts as no name.
 */
function usableName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return /^[\d\s+().-]*$/.test(trimmed) ? '' : trimmed;
}

/**
 * Fill the variables of `text` from `contact`.
 *
 * A variable with no value is taken out rather than left as braces, and
 * the gap it leaves is closed: "Olá {{primeiro_nome}}, tudo bem?"
 * becomes "Olá, tudo bem?", not "Olá , tudo bem?". The caller is told
 * which were missing, so the person sending can check the result.
 *
 * Anything else between braces — `{{vars.x}}` from a flow, a typo — is
 * left exactly as written: silently deleting it would hide the mistake.
 */
export function fillQuickReply(text: string, contact: QuickReplyContact): FilledQuickReply {
  const name = usableName(contact.name);
  const values: Record<QuickReplyVariable, string> = {
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] ?? '',
    empresa: (contact.company ?? '').trim(),
  };
  const missing = new Set<QuickReplyVariable>();

  const filled = String(text ?? '').replace(
    /( ?)\{\{\s*(nome|primeiro_nome|empresa)\s*\}\}( ?)/gi,
    (match: string, before: string, key: string, after: string, offset: number, whole: string) => {
      const variable = key.toLowerCase() as QuickReplyVariable;
      const value = values[variable];
      if (value) return `${before}${value}${after}`;

      missing.add(variable);
      const next = whole[offset + match.length] ?? '';
      // Between two words: one space stays. Before punctuation or at
      // the end of a line: none does.
      if (before && after) return ' ';
      if (before && (next === '' || next === '\n' || /[,.!?;:]/.test(next))) return '';
      return before || after;
    }
  );

  if (missing.size === 0) return { text: filled, missing: [] };

  // A line that began with the variable now begins with what followed
  // it: drop a stranded space or comma there.
  const tidy = filled
    .split('\n')
    .map((line) => line.replace(/^[ \t]*[,;:][ \t]*/, '').replace(/^[ \t]+/, ''))
    .join('\n');
  return { text: tidy, missing: QUICK_REPLY_VARIABLES.filter((v) => missing.has(v)) };
}
