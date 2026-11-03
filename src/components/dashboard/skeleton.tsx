import { cn } from '@/lib/utils'

/**
 * Shared skeleton primitive — a block sized to whatever container it's
 * dropped into, with a highlight sweeping across it. Used by every
 * dashboard widget while its data fetches.
 *
 * The sweep replaced a whole-block opacity pulse: a travelling
 * highlight reads as "work in progress" where a pulse reads as
 * something blinking for attention. `fx-shimmer` paints its own
 * background, so no bg utility is needed here.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('fx-shimmer rounded-md', className)} />
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'surface rounded-2xl p-5',
        className,
      )}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-20" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  )
}

/**
 * Placeholder for one chrome-less stat in a `DisplayHeading` row.
 * Mirrors the real thing's rhythm (small label, display figure, delta)
 * so the heading doesn't reflow when the numbers land.
 */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-2.5 h-9 w-20" />
      <Skeleton className="mt-2 h-3.5 w-16" />
    </div>
  )
}
