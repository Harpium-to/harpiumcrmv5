import Link from 'next/link'

import { METRIC_WINDOWS, type MetricWindow } from '@/lib/agencia/queries'

/** 7d / 30d / 90d period selector, driven by the `?dias=` query string. */
export function PeriodTabs({
  basePath,
  current,
  params,
}: {
  basePath: string
  current: MetricWindow
  params?: Record<string, string | undefined>
}) {
  const href = (d: number) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params ?? {})) if (v) sp.set(k, v)
    sp.set('dias', String(d))
    return `${basePath}?${sp.toString()}`
  }

  return (
    <div className="flex gap-1.5">
      {METRIC_WINDOWS.map((d) => (
        <Link
          key={d}
          href={href(d)}
          className={`rounded-full border px-3 py-1 text-sm ${
            current === d
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {d} dias
        </Link>
      ))}
    </div>
  )
}
