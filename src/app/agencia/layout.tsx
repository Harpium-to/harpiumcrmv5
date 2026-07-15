import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'

import { loadAgencia } from '@/lib/agencia/guard'

// Noindex, like the dashboard layout — the agency console is a
// privileged internal surface and must never be crawled.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
}

export default async function AgenciaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gate = await loadAgencia()

  // Not signed in → login. Signed in but not agency → back to their own
  // dashboard (they still have a personal account like any owner).
  if (gate.status === 'unauthed') redirect('/login')
  if (gate.status === 'forbidden') redirect('/dashboard')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/agencia" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </span>
            <span className="text-lg font-semibold">Agência · Super-visão</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/agencia/marca"
              className="text-muted-foreground hover:text-foreground"
            >
              Marca
            </Link>
            <Link
              href="/agencia/auditoria"
              className="text-muted-foreground hover:text-foreground"
            >
              Auditoria
            </Link>
            <Link
              href="/agencia/membros"
              className="text-muted-foreground hover:text-foreground"
            >
              Membros
            </Link>
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground"
            >
              Meu painel →
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  )
}
