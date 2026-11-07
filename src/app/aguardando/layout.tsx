import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Glow } from '@/components/ui/glow'

export const metadata: Metadata = {
  title: 'Aguardando liberação',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
}

export default function AguardandoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <Glow className="-top-32 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2" />
      {children}
    </div>
  )
}
