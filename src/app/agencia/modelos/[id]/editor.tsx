'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Loader2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  AGENCY_ACCESS_LABEL,
  AGENCY_ACCESS_LEVELS,
  CRM_NICHES,
  type AgencyAccessLevel,
} from '@/lib/agencia/crm'
import { parseTemplateContent } from '@/lib/agencia/templates'

const selectClass =
  'mt-1 h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground'

interface Initial {
  name: string
  description: string
  niche: string
  suggestedAccess: AgencyAccessLevel
  active: boolean
  content: string
}

/**
 * super_admin editor. The content is edited as JSON (the format is
 * documented in migration 053) and checked by the same validator the
 * API uses before anything is saved.
 */
export function TemplateEditor({
  id,
  builtIn,
  initial,
}: {
  id: string
  builtIn: boolean
  initial: Initial
}) {
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    let content: unknown
    try {
      content = JSON.parse(form.content)
    } catch {
      setErrors(['O conteúdo não é um JSON válido.'])
      return
    }
    const parsed = parseTemplateContent(content)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors([])
    setBusy('save')
    try {
      const res = await fetch(`/api/agencia/modelos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          niche: form.niche || null,
          suggestedAccess: form.suggestedAccess,
          active: form.active,
          content: parsed.content,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (Array.isArray(json.details)) setErrors(json.details)
        throw new Error(json.error ?? 'Falha ao salvar')
      }
      toast.success('Modelo salvo.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setBusy(null)
    }
  }

  const duplicate = async () => {
    setBusy('dup')
    try {
      const res = await fetch('/api/agencia/modelos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateOf: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao duplicar')
      router.push(`/agencia/modelos/${json.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao duplicar')
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!window.confirm('Excluir este modelo? Os CRMs onde ele foi aplicado continuam como estão.')) {
      return
    }
    setBusy('del')
    try {
      const res = await fetch(`/api/agencia/modelos/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao excluir')
      router.push('/agencia/modelos')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir')
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="tpl-name" className="text-muted-foreground">
            Nome
          </Label>
          <Input
            id="tpl-name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="mt-1 border-border bg-muted"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tpl-niche" className="text-muted-foreground">
              Nicho
            </Label>
            <select
              id="tpl-niche"
              value={form.niche}
              onChange={(e) => set('niche', e.target.value)}
              className={selectClass}
            >
              <option value="">Sem nicho</option>
              {CRM_NICHES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="tpl-access" className="text-muted-foreground">
              Acesso sugerido
            </Label>
            <select
              id="tpl-access"
              value={form.suggestedAccess}
              onChange={(e) => set('suggestedAccess', e.target.value as AgencyAccessLevel)}
              className={selectClass}
            >
              {AGENCY_ACCESS_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {AGENCY_ACCESS_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="tpl-desc" className="text-muted-foreground">
            Descrição
          </Label>
          <Input
            id="tpl-desc"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="mt-1 border-border bg-muted"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <Switch checked={form.active} onCheckedChange={(v) => set('active', v === true)} />
        Ativo (aparece ao criar CRMs e para aplicar)
      </label>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Conteúdo (JSON, avançado)
        </summary>
        <div className="space-y-2 p-3">
          <p className="text-xs text-muted-foreground">
            Passos referenciam etiquetas e funis pelo nome (&quot;tag&quot;, &quot;pipeline&quot;,
            &quot;stage&quot;). Gatilhos aceitos: first_inbound_message, new_contact_created,
            keyword_match, new_message_received. Passos aceitos: send_message, wait, add_tag,
            remove_tag, create_deal, close_conversation.
          </p>
          <Textarea
            aria-label="Conteúdo do modelo em JSON"
            rows={18}
            spellCheck={false}
            value={form.content}
            onChange={(e) => set('content', e.target.value)}
            className="border-border bg-muted font-mono text-xs"
          />
        </div>
      </details>

      {errors.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-lg border border-red-500/30 bg-red-500/10 py-2 pr-3 pl-7 text-sm">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {!builtIn && (
          <Button variant="ghost" onClick={remove} disabled={busy !== null} className="mr-auto text-red-500">
            {busy === 'del' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Excluir
          </Button>
        )}
        <Button variant="outline" onClick={duplicate} disabled={busy !== null}>
          {busy === 'dup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          Duplicar
        </Button>
        <Button onClick={save} disabled={busy !== null}>
          {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      </div>
    </section>
  )
}
