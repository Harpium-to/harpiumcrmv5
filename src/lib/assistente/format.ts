// ============================================================
// Small formatting helpers shared by the tools and the prompt.
// Pure, so the tool output the model sees is predictable in tests.
// ============================================================

/** "19/11/2026 14:05" in the person's zone. */
export function dateTime(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: safeZone(timeZone),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/** "19/11/2026" in the person's zone. */
export function dateOnly(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: safeZone(timeZone),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export function money(value: number | null | undefined, currency = 'BRL'): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

export function safeZone(zone: string | null | undefined): string {
  if (!zone) return 'America/Sao_Paulo'
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: zone })
    return zone
  } catch {
    return 'America/Sao_Paulo'
  }
}

/** Whole days between an instant and now (never negative). */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

export function clip(text: string | null | undefined, max: number): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * Serialize a tool result for the model, bounded. A huge result costs
 * money on every later turn (it stays in the history) and crowds out
 * the rules; the tools already page, this is the last guard.
 */
export function toolJson(value: unknown, max = 12_000): string {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [resultado cortado: peça menos itens ou filtre melhor]`
}

export const LINKS = {
  contact: (id: string) => `/contacts?contact=${id}`,
  conversation: (id: string) => `/inbox?c=${id}`,
  automation: (id: string) => `/automations/${id}/edit`,
  automationLogs: (id: string) => `/automations/${id}/logs`,
  flow: (id: string) => `/flows/${id}`,
  pipelines: () => '/pipelines',
  agenda: () => '/agenda',
  agents: () => '/agents',
  leads: () => '/leads',
  reports: () => '/relatorios',
} as const

export const TEMPERATURE_LABEL: Record<string, string> = {
  cold: 'frio',
  warm: 'morno',
  hot: 'quente',
}
