// ============================================================
// `{{ … }}` in automation steps — pure, unit-tested.
//
//   {{ message.text }}           the customer's message (message triggers)
//   {{ vars.x }}                 what the trigger provides (e.g. a lead's
//                                {{ vars.primeiro_nome }}, {{ vars.origem }})
//   {{ contato.primeiro_nome }}  the contact, in every trigger:
//                                nome, primeiro_nome, empresa, cidade,
//                                email, telefone, cargo, instagram
//   {{ campo.faturamento }}      any custom field, by its name folded
//                                (lib/contacts/profile.ts variableKey)
//
// In a message to the customer, a variable with no value is taken out
// and the gap it leaves is closed, the way quick replies do it: "Olá
// {{ contato.primeiro_nome }}, tudo bem?" → "Olá, tudo bem?". Elsewhere
// (a field value, a webhook body) it becomes "".
// ============================================================

export interface TemplateValues {
  messageText?: string
  vars?: Record<string, unknown>
  /** `contato.*` and `campo.*` (contactVariables in lib/contacts/profile). */
  contact?: Record<string, string>
}

/** The variables the editor offers for the contact. */
export const CONTACT_VARIABLES = [
  'contato.primeiro_nome',
  'contato.nome',
  'contato.empresa',
  'contato.cidade',
  'contato.email',
  'contato.telefone',
] as const

const VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g

/** Does the text use contact or field variables (worth loading the contact)? */
export function usesContactVariables(text: string): boolean {
  return /\{\{\s*(contato|campo)\.[\w.]+\s*\}\}/.test(text)
}

function valueOf(key: string, values: TemplateValues): string {
  if (key === 'message.text') return String(values.messageText ?? '')
  if (key.startsWith('vars.')) {
    const v = values.vars?.[key.slice('vars.'.length)]
    return v === null || v === undefined ? '' : String(v)
  }
  if (key.startsWith('contato.') || key.startsWith('campo.')) {
    return values.contact?.[key] ?? ''
  }
  return ''
}

/**
 * Fill the `{{ … }}` of `text`. With `closeGaps` (messages to the
 * customer), an empty variable is removed along with the space or
 * comma it would leave behind.
 */
export function renderTemplate(
  text: string,
  values: TemplateValues,
  options: { closeGaps?: boolean } = {},
): string {
  const source = String(text ?? '')
  if (!options.closeGaps) {
    return source.replace(VARIABLE, (_, key: string) => valueOf(key, values))
  }

  let emptied = false
  const filled = source.replace(
    /( ?)\{\{\s*([\w.]+)\s*\}\}( ?)/g,
    (match: string, before: string, key: string, after: string, offset: number, whole: string) => {
      const value = valueOf(key, values)
      if (value) return `${before}${value}${after}`
      emptied = true
      const next = whole[offset + match.length] ?? ''
      // Between two words one space stays; before punctuation or at
      // the end of a line, none does.
      if (before && after) return ' '
      if (before && (next === '' || next === '\n' || /[,.!?;:]/.test(next))) return ''
      return before || after
    },
  )
  if (!emptied) return filled
  // A line that began with the variable now begins with what followed.
  return filled
    .split('\n')
    .map((line) => line.replace(/^[ \t]*[,;:][ \t]*/, '').replace(/^[ \t]+/, ''))
    .join('\n')
}
