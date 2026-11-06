'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AGENCY_ACCESS_DESCRIPTION,
  AGENCY_ACCESS_LABEL,
  AGENCY_ACCESS_LEVELS,
  CRM_NICHES,
  type AgencyAccessLevel,
} from '@/lib/agencia/crm'
import type { AgencyOperator } from '@/lib/agencia/crms'
import { describeCounts, type TemplateCounts } from '@/lib/agencia/templates'
import { AGENCIA_ROLE_LABEL, type AgenciaRole } from '@/lib/agencia/roles'
import { InviteLink, type OwnerInviteResult } from '../invite-link'

export interface TemplateOption {
  id: string
  name: string
  niche: string | null
  suggestedAccess: AgencyAccessLevel
  counts: TemplateCounts
}

const selectClass =
  'mt-1 h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground'

export function NovoCrmForm({
  operators,
  templates,
  myRole,
  myUserId,
  initialEmail,
  initialName,
}: {
  operators: AgencyOperator[]
  templates: TemplateOption[]
  myRole: AgenciaRole
  myUserId: string
  initialEmail: string
  initialName: string
}) {
  const [name, setName] = useState(initialName)
  const [ownerEmail, setOwnerEmail] = useState(initialEmail)
  const [niche, setNiche] = useState('')
  const [accessLevel, setAccessLevel] = useState<AgencyAccessLevel>('metrics')
  // A manager's CRM is always theirs; a super_admin picks.
  const [managerUserId, setManagerUserId] = useState(
    myRole === 'manager' ? myUserId : '',
  )
  const [notes, setNotes] = useState('')
  const [templateId, setTemplateId] = useState('')
  // Once the operator picks a template or a level by hand, choosing a
  // niche stops overriding them.
  const [templateTouched, setTemplateTouched] = useState(false)
  const [accessTouched, setAccessTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{
    accountId: string
    invite: OwnerInviteResult
    template: { text: string } | { error: string } | null
  } | null>(null)

  const chosen = templates.find((t) => t.id === templateId) ?? null

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t && !accessTouched) setAccessLevel(t.suggestedAccess)
  }

  const pickNiche = (value: string) => {
    setNiche(value)
    if (!templateTouched) {
      const match = templates.find((t) => t.niche === value)
      pickTemplate(match?.id ?? '')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/agencia/crms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ownerEmail,
          niche: niche || null,
          accessLevel,
          managerUserId: managerUserId || null,
          notes,
          templateId: templateId || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao criar o CRM')
      setCreated(json)
      toast.success('CRM criado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar o CRM')
    } finally {
      setSaving(false)
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        {created.template && 'text' in created.template && (
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <span className="font-medium">Modelo aplicado.</span> {created.template.text}
          </p>
        )}
        {created.template && 'error' in created.template && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
            O CRM foi criado, mas o modelo não foi aplicado: {created.template.error} Dá
            para aplicar de novo na página do CRM.
          </p>
        )}
        <InviteLink invite={created.invite} />
        <div className="flex flex-wrap gap-2">
          <Link href={`/agencia/${created.accountId}`}>
            <Button>Abrir o CRM no painel</Button>
          </Link>
          <Link href="/agencia/novo">
            <Button variant="outline" onClick={() => setCreated(null)}>
              Criar outro
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-xl border border-border bg-card p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="crm-name" className="text-muted-foreground">
            Nome do CRM
          </Label>
          <Input
            id="crm-name"
            required
            maxLength={120}
            placeholder="ex.: Clínica Dr. Fulano"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 border-border bg-muted"
          />
        </div>
        <div>
          <Label htmlFor="crm-owner" className="text-muted-foreground">
            E-mail do dono
          </Label>
          <Input
            id="crm-owner"
            type="email"
            required
            placeholder="dono@cliente.com"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            className="mt-1 border-border bg-muted"
          />
        </div>
        <div>
          <Label htmlFor="crm-niche" className="text-muted-foreground">
            Nicho
          </Label>
          <select
            id="crm-niche"
            value={niche}
            onChange={(e) => pickNiche(e.target.value)}
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
        <div className="sm:col-span-2">
          <Label htmlFor="crm-template" className="text-muted-foreground">
            Modelo
          </Label>
          <select
            id="crm-template"
            value={templateId}
            onChange={(e) => {
              setTemplateTouched(true)
              pickTemplate(e.target.value)
            }}
            className={selectClass}
          >
            <option value="">Sem modelo (CRM vazio)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {chosen
              ? `Vai criar: ${describeCounts(chosen.counts)}. Automações chegam desligadas.`
              : 'Funil, etiquetas, campos, respostas rápidas e automações prontos para o ramo.'}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="crm-manager" className="text-muted-foreground">
            Gestor responsável
          </Label>
          <select
            id="crm-manager"
            value={managerUserId}
            disabled={myRole === 'manager'}
            onChange={(e) => setManagerUserId(e.target.value)}
            className={selectClass}
          >
            <option value="">Ninguém por enquanto</option>
            {operators.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name} · {AGENCIA_ROLE_LABEL[o.role]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Um gestor só opera os CRMs da própria carteira.
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm text-muted-foreground">
          Acesso da agência que você propõe
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {AGENCY_ACCESS_LEVELS.map((level) => (
            <label
              key={level}
              className={`cursor-pointer rounded-xl border p-3 text-sm transition-colors ${
                accessLevel === level
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'
              }`}
            >
              <input
                type="radio"
                name="access-level"
                value={level}
                checked={accessLevel === level}
                onChange={() => {
                  setAccessTouched(true)
                  setAccessLevel(level)
                }}
                className="sr-only"
              />
              <span className="font-medium">{AGENCY_ACCESS_LABEL[level]}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {AGENCY_ACCESS_DESCRIPTION[level]}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          O dono vê este nível no convite. Para clínicas e consultórios
          (dados de saúde), comece em Métricas.
        </p>
      </fieldset>

      <div>
        <Label htmlFor="crm-notes" className="text-muted-foreground">
          Observações <span className="text-xs">(só a agência vê)</span>
        </Label>
        <Textarea
          id="crm-notes"
          rows={3}
          maxLength={2000}
          placeholder="Contrato, combinados, contatos…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 border-border bg-muted"
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Criar CRM e gerar convite
        </Button>
      </div>
    </form>
  )
}
