'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, LayoutTemplate, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { describeApplySummary, describeCounts, type TemplateCounts } from '@/lib/agencia/templates'

export interface TemplatePanelProps {
  accountId: string
  templates: { id: string; name: string; counts: TemplateCounts }[]
  applications: { templateName: string; appliedAt: string; summary: Record<string, unknown> }[]
  /** Operator may act on this CRM (super_admin, or its manager). */
  canEdit: boolean
  /** Onboarding, or the owner granted full access. */
  canApplyNow: boolean
  /** super_admin, and the owner granted more than metrics (or onboarding). */
  canSave: boolean
  isSuper: boolean
}

const selectClass =
  'h-9 min-w-0 flex-1 rounded-md border border-border bg-muted px-2 text-sm text-foreground'

/**
 * Templates on a CRM's page: what was applied, apply another (additive,
 * needs onboarding or full consent), and save this CRM as a template.
 */
export function TemplatesPanel(props: TemplatePanelProps) {
  const router = useRouter()
  const [templateId, setTemplateId] = useState(props.templates[0]?.id ?? '')
  const [applying, setApplying] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const chosen = props.templates.find((t) => t.id === templateId)

  const apply = async () => {
    if (!chosen) return
    if (
      !window.confirm(
        `Aplicar o modelo "${chosen.name}"? Só entra o que ainda não existe no CRM (pelo nome). Automações chegam desligadas.`,
      )
    ) {
      return
    }
    setApplying(true)
    try {
      const res = await fetch(`/api/agencia/crms/${props.accountId}/modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao aplicar o modelo')
      toast.success(json.text ?? 'Modelo aplicado.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao aplicar o modelo')
    } finally {
      setApplying(false)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/agencia/modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAccountId: props.accountId, name: saveName }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao salvar o modelo')
      toast.success('Modelo salvo.')
      router.push(`/agencia/modelos/${json.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar o modelo')
      setSaving(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
        <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
        Modelos
      </h2>
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          {props.applications.length === 0 ? (
            <p className="text-muted-foreground">Nenhum modelo aplicado a este CRM.</p>
          ) : (
            <ul className="space-y-2">
              {props.applications.map((a, i) => (
                <li key={i}>
                  <p>
                    <span className="font-medium">{a.templateName}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      em {new Date(a.appliedAt).toLocaleDateString('pt-BR')}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {describeApplySummary(a.summary)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {props.canEdit && props.templates.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  aria-label="Modelo"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className={selectClass}
                  disabled={!props.canApplyNow}
                >
                  {props.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={!props.canApplyNow || applying || !chosen}
                  onClick={apply}
                >
                  {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                  Aplicar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {props.canApplyNow
                  ? chosen
                    ? `${describeCounts(chosen.counts)}. Só entra o que ainda não existe.`
                    : null
                  : 'Aplicar um modelo mexe no CRM do cliente: só em implantação ou com acesso Total liberado pelo dono.'}
              </p>
            </div>
          )}

          {props.isSuper && (
            <form onSubmit={save} className="space-y-2">
              <div className="flex gap-2">
                <Input
                  aria-label="Nome do novo modelo"
                  placeholder="Nome do novo modelo"
                  value={saveName}
                  required
                  disabled={!props.canSave}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="border-border bg-muted"
                />
                <Button type="submit" variant="outline" disabled={!props.canSave || saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  Salvar como modelo
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {props.canSave
                  ? 'Copia funis, etiquetas, campos, respostas rápidas e automações. Nunca contatos ou conversas.'
                  : 'O dono deste CRM liberou só Métricas: a configuração dele não pode ser copiada.'}
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
