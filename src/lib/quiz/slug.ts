// ============================================================
// The public address of a quiz: /q/<slug>.
//
// One namespace for every CRM, so a slug is checked for shape here and
// for being free in the database (quizzes.slug is UNIQUE).
// ============================================================

const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/

/**
 * Addresses no quiz can take: the app's own top-level routes (on the
 * quizzes' domain a quiz answers at /<slug>, so a quiz called "login"
 * would never be reachable there) and a few kept for later.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api', 'app', 'www', 'admin', 'painel', 'embed', 'novo', 'quiz', 'icon', 'auth',
  'login', 'signup', 'forgot-password', 'reset-password', 'join', 'marcar', 'privacidade',
  'dashboard', 'inbox', 'contacts', 'leads', 'canais', 'pipelines', 'agenda', 'broadcasts',
  'automations', 'flows', 'agents', 'relatorios', 'ferramentas', 'notifications', 'settings',
  'agencia', 'aguardando', 'ajuda', 'conectar-google',
])
const RESERVED = RESERVED_SLUGS

/** "Quiz Móveis Planejados!" → "quiz-moveis-planejados". */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug) && !slug.includes('--') && !RESERVED.has(slug)
}

/** What is wrong with a slug someone typed, in words — or null. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return 'O endereço precisa de pelo menos 3 caracteres.'
  if (slug.length > 60) return 'O endereço pode ter no máximo 60 caracteres.'
  if (RESERVED.has(slug)) return 'Esse endereço é reservado. Escolha outro.'
  if (!isValidSlug(slug)) {
    return 'Use só letras minúsculas, números e hífens, sem começar ou terminar com hífen.'
  }
  return null
}

/** A slug for a new quiz: its name plus a short random tail. */
export function proposeSlug(name: string, tail: string): string {
  const base = slugFromName(name) || 'quiz'
  return `${base}-${tail}`.slice(0, 60)
}

/**
 * The host kept for public quizzes, when the deployment has one
 * (NEXT_PUBLIC_QUIZ_URL, e.g. https://quiz.harpium.com.br). On it a
 * quiz answers at the short address /<slug>; src/proxy.ts maps that to
 * /q/<slug>.
 */
export function quizHostUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_QUIZ_URL ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^/]+$/i.test(raw) ? raw : null
}

/**
 * The link to share. On the quizzes' own domain when there is one,
 * otherwise on the address the CRM itself is open at.
 */
export function publicQuizUrl(origin: string, slug: string): string {
  const host = quizHostUrl()
  if (host) return `${host}/${slug}`
  return `${origin.replace(/\/+$/, '')}/q/${slug}`
}

/**
 * The address an <iframe> on someone's site loads. Always the /q/ form,
 * on whichever host: that is the path the app serves without the
 * headers that forbid embedding (next.config.ts).
 */
export function embedQuizUrl(origin: string, slug: string): string {
  const host = quizHostUrl() ?? origin.replace(/\/+$/, '')
  return `${host}/q/${slug}?embed=1`
}
