/**
 * Compact relative time: "agora", "4 min", "2 h", "3 d".
 *
 * Deliberately not `formatDistanceToNow`. The live monitor packs a
 * timestamp onto every row, and "about 2 hours ago" costs more width
 * than the row has while saying nothing extra at a glance. The short
 * form is also locale-neutral apart from one word, which keeps the
 * feed readable without pulling a date-fns locale into the bundle for
 * the sake of it.
 */
export function compactAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 45) return 'agora'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks} sem`
  return `${Math.round(days / 30)} m`
}

/** Milliseconds as "840 ms" / "2,4 s" — whichever reads faster. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}
