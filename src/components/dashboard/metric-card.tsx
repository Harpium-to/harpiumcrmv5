import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/ui/animated-number'

interface MetricCardProps {
  title: string
  /**
   * A number counts up on mount and re-counts when it changes, so a
   * refreshed metric shows that it moved. Strings render verbatim, for
   * values with no meaningful numeric form.
   */
  value: number | string
  /**
   * Formats a numeric `value` — e.g. `(n) => formatCurrency(n, 'BRL')`.
   * Defaults to locale-grouped digits. Ignored for string values.
   */
  format?: (value: number) => string
  /** Optional, drawn small beside the label rather than in a tile. */
  icon?: ComponentType<{ className?: string }>
  /** Small superscript after the value, e.g. "/6". */
  suffix?: string
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs ontem". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
  className?: string
}

/**
 * One headline number, with no box around it.
 *
 * It used to be a bordered card in a four-up grid. The redesign reads
 * the top of a screen as a single sentence — heading, then the numbers
 * that qualify it — and a row of four outlined boxes fights that: each
 * border is a full stop. Dropping the chrome lets the figures sit
 * directly on the warm plane, which is also why they can be set this
 * large without the page feeling crowded.
 *
 * Still a shared component rather than inline markup, because the
 * label/figure/delta rhythm has to match everywhere it appears.
 */
export function MetricCard({
  title,
  value,
  format,
  icon: Icon,
  suffix,
  delta,
  subtitle,
  className,
}: MetricCardProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="eyebrow flex items-center gap-1.5 truncate">
        {Icon ? <Icon className="size-3.5 shrink-0 opacity-70" /> : null}
        {title}
      </p>
      <p className="display-sm mt-1.5 flex items-start text-foreground">
        <span className="tabular-nums">
          {typeof value === 'number' ? (
            <AnimatedNumber value={value} format={format} />
          ) : (
            value
          )}
        </span>
        {suffix ? (
          <span className="mt-1 ml-0.5 text-base text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </p>
      {delta ? (
        <DeltaRow sign={delta.sign} label={delta.label} />
      ) : subtitle ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
      ? 'text-destructive'
      : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('mt-1.5 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="size-3.5" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
