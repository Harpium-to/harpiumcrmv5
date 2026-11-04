import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { loadAgencia } from '@/lib/agencia/guard'
import { listAgencyOperators } from '@/lib/agencia/crms'
import { listTemplates } from '@/lib/agencia/template-store'
import { hasAgenciaRole } from '@/lib/agencia/roles'
import { NovoCrmForm } from './form'

export const dynamic = 'force-dynamic'

export default async function NovoCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; nome?: string }>
}) {
  const gate = await loadAgencia()
  if (gate.status !== 'ok') redirect('/agencia')
  // Support can look, not create.
  if (!hasAgenciaRole(gate.role, 'manager')) redirect('/agencia')

  const { email, nome } = await searchParams
  const [operators, templates] = await Promise.all([
    listAgencyOperators(gate.admin),
    listTemplates(gate.admin),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/agencia"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Todos os CRMs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Novo CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cria o CRM do cliente em implantação e um convite para o dono. O dono
          vê o nível de acesso da agência antes de aceitar.
        </p>
      </div>
      <NovoCrmForm
        operators={operators}
        templates={(templates ?? [])
          .filter((t) => t.active)
          .map((t) => ({
            id: t.id,
            name: t.name,
            niche: t.niche,
            suggestedAccess: t.suggestedAccess,
            counts: t.counts,
          }))}
        myRole={gate.role}
        myUserId={gate.userId}
        initialEmail={email ?? ''}
        initialName={nome ?? ''}
      />
    </div>
  )
}
