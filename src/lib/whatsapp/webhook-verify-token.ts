import { createHash, timingSafeEqual } from 'crypto'

/**
 * Does `candidate` match the app-wide webhook verify token?
 *
 * Meta checks the callback URL once per app, with the token typed into
 * the app's webhook settings — not once per customer. Accounts
 * connected through Embedded Signup never had a token of their own, so
 * `META_WEBHOOK_VERIFY_TOKEN` is the single value for the whole app.
 * Per-account tokens saved by the manual form keep working alongside it.
 *
 * Compared as SHA-256 digests so the comparison is constant-time and
 * the lengths always match. Unset or blank env → never matches.
 */
export function matchesAppVerifyToken(
  candidate: string | null | undefined,
  expected: string | undefined = process.env.META_WEBHOOK_VERIFY_TOKEN,
): boolean {
  const want = expected?.trim()
  if (!want || !candidate) return false
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(want).digest()
  return timingSafeEqual(a, b)
}
