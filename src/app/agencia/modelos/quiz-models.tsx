'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ListChecks, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { AgencyModelSummary } from '@/lib/quiz/agency-models'

/**
 * The agency's quiz models (migration 072). They are saved from inside
 * a CRM (Ferramentas › Quiz › Divulgação) and offered to every CRM in
 * "Novo quiz"; here they are only listed and removed.
 */
export function QuizModels({ models, canManage }: { models: AgencyModelSummary[]; canManage: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const remove = async (model: AgencyModelSummary) => {
    if (
      !window.confirm(
        `Apagar o modelo "${model.name}"? Ele some do "Novo quiz" de todos os CRMs. Os quizzes já criados a partir dele continuam.`,
      )
    ) {
      return
    }
    setBusy(model.id)
    try {
      const res = await fetch(`/api/agencia/quiz-modelos/${model.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Falha ao apagar o modelo')
      toast.success(`Modelo "${model.name}" apagado`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao apagar o modelo')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Modelos de quiz</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Quizzes que a agência montou e deixou prontos. Aparecem no “Novo quiz” de todos os
          CRMs, ao lado dos modelos do sistema. Para criar um, entre num CRM, abra o quiz em
          Ferramentas e use “Salvar como modelo da agência”, na aba Divulgação.
        </p>
      </div>
      {models.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Nenhum modelo de quiz da agência ainda.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => (
            <li key={model.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <ListChecks className="h-4 w-4 text-muted-foreground" />
                  {model.name}
                </h3>
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy !== null}
                    aria-label={`Apagar o modelo ${model.name}`}
                    onClick={() => void remove(model)}
                    className="shrink-0 text-muted-foreground hover:text-red-500"
                  >
                    {busy === model.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  </Button>
                ) : null}
              </div>
              {model.description ? (
                <p className="text-sm text-muted-foreground">{model.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
