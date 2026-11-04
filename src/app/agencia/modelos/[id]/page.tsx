import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import { getTemplate } from '@/lib/agencia/template-store'
import { describeCounts } from '@/lib/agencia/templates'
import { TemplateView } from './view'
import { TemplateEditor } from './editor'

export const dynamic = 'force-dynamic'

export default async function ModeloPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { admin, role } = await requireAgencia()
  const tpl = await getTemplate(admin, id)
  if (!tpl) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/agencia/modelos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Modelos
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{tpl.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tpl.builtIn ? 'Modelo do sistema' : 'Modelo da agência'} ·{' '}
          {describeCounts(tpl.counts)}
          {!tpl.active && ' · desativado'}
        </p>
      </div>

      {role === 'super_admin' && (
        <TemplateEditor
          id={tpl.id}
          builtIn={tpl.builtIn}
          initial={{
            name: tpl.name,
            description: tpl.description ?? '',
            niche: tpl.niche ?? '',
            suggestedAccess: tpl.suggestedAccess,
            active: tpl.active,
            content: JSON.stringify(tpl.content, null, 2),
          }}
        />
      )}

      <TemplateView content={tpl.content} />
    </div>
  )
}
