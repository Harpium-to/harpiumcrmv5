import Link from 'next/link'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

// Shared server-component bits for the deep per-account sub-pages
// (contatos, inbox, pipeline). Read-only, no client JS.

export function BackToAccount({ accountId }: { accountId: string }) {
  return (
    <Link
      href={`/agencia/${accountId}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar para a conta
    </Link>
  )
}

/** Prev/next pager driven by the `?page=` query string. */
export function Pager({
  basePath,
  page,
  total,
  pageSize,
}: {
  basePath: string
  page: number
  total: number
  pageSize: number
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const href = (p: number) => `${basePath}?page=${p}`
  const prevDisabled = page <= 1
  const nextDisabled = page >= totalPages

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Página {page} de {totalPages} · {total.toLocaleString()} no total
      </span>
      <div className="flex items-center gap-2">
        <PagerLink href={href(page - 1)} disabled={prevDisabled}>
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </PagerLink>
        <PagerLink href={href(page + 1)} disabled={nextDisabled}>
          Próxima
          <ChevronRight className="h-4 w-4" />
        </PagerLink>
      </div>
    </div>
  )
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: React.ReactNode
}) {
  const cls =
    'inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5'
  if (disabled) {
    return (
      <span className={`${cls} cursor-not-allowed text-muted-foreground/50`}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href} className={`${cls} hover:bg-muted`}>
      {children}
    </Link>
  )
}

/** Parse a `page` query param into a positive integer (defaults to 1). */
export function parsePage(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}
