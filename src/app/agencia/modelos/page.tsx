import Link from 'next/link'
import { ArrowLeft, LayoutTemplate } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { listTemplates } from '@/lib/agencia/template-store'
import { AGENCY_ACCESS_LABEL, nicheLabel } from '@/lib/agencia/crm'
import { hasAgenciaRole } from '@/lib/agencia/roles'
import { describeCounts } from '@/lib/agencia/templates'
import { listAgencyModels } from '@/lib/quiz/agency-models'
import { NewTemplateButton } from './new-template'
import { QuizModels } from './quiz-models'

export const dynamic = 'force-dynamic'

export default async function ModelosPage() {
  const { admin, role } = await requireAgencia()
  const templates = await listTemplates(admin)
  const quizModels = await listAgencyModels(admin)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/agencia"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Painel da plataforma
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Modelos por nicho</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pacotes prontos para um CRM novo: funil e etapas, etiquetas, campos,
            respostas rápidas e automações (que chegam desligadas). Aplicar um
            modelo copia; mudar o modelo depois não altera os CRMs onde ele já foi usado.
          </p>
        </div>
        {role === 'super_admin' && templates !== null && <NewTemplateButton />}
      </div>

      {templates === null ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Modelos exigem a migration 053 aplicada no Supabase.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/agencia/modelos/${t.id}`}
              className={`fx-lift flex flex-col gap-2 rounded-xl border border-border bg-card p-4 ${
                t.active ? '' : 'opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold">
                  <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                  {t.name}
                </h2>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.builtIn ? 'do sistema' : 'da agência'}
                  {!t.active && ' · desativado'}
                </span>
              </div>
              {t.description && (
                <p className="text-sm text-muted-foreground">{t.description}</p>
              )}
              <p className="text-xs text-muted-foreground">{describeCounts(t.counts)}</p>
              <p className="mt-auto flex flex-wrap gap-1.5 pt-1 text-xs">
                {t.niche && (
                  <span className="rounded-full bg-muted px-2 py-0.5">{nicheLabel(t.niche)}</span>
                )}
                <span className="rounded-full bg-muted px-2 py-0.5">
                  Acesso sugerido: {AGENCY_ACCESS_LABEL[t.suggestedAccess]}
                </span>
              </p>
            </Link>
          ))}
        </div>
      )}

      <QuizModels models={quizModels} canManage={hasAgenciaRole(role, 'manager')} />
    </div>
  )
}
