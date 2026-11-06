'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AGENCY_ACCESS_DESCRIPTION,
  AGENCY_ACCESS_LABEL,
  CRM_NICHES,
  CRM_STATUSES,
  CRM_STATUS_DESCRIPTION,
  CRM_STATUS_LABEL,
  nicheLabel,
  type AgencyAccessLevel,
  type CrmStatus,
} from '@/lib/agencia/crm'
import type { AgencyOperator, PendingOwnerInvite } from '@/lib/agencia/crms'
import { AGENCIA_ROLE_LABEL, type AgenciaRole } from '@/lib/agencia/roles'
import type { ConsentGate } from '@/lib/agencia/consent'
import { InviteLink, type OwnerInviteResult } from '../invite-link'
import { RequestAccessForm } from './request-access'

const selectClass =
  'mt-1 h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground disabled:opacity-60'

export interface ManageProps {
  accountId: string
  name: string
  status: CrmStatus
  niche: string | null
  managerUserId: string | null
  notes: string | null
  ownerEmail: string | null
  pendingOwner: PendingOwnerInvite | null
  agencyLevel: AgencyAccessLevel | null
  /** Pending request / who may ask (Fase 3). */
  gate?: ConsentGate
  operators: AgencyOperator[]
  myRole: AgenciaRole
  /** super_admin, or a manager whose portfolio has this CRM. */
  canEdit: boolean
}

export function CrmManagePanel(props: ManageProps) {
  const router = useRouter()
  const isSuper = props.myRole === 'super_admin'

  const [name, setName] = useState(props.name)
  const [status, setStatus] = useState<CrmStatus>(props.status)
  const [niche, setNiche] = useState(props.niche ?? '')
  const [managerUserId, setManagerUserId] = useState(props.managerUserId ?? '')
  const [notes, setNotes] = useState(props.notes ?? '')
  const [saving, setSaving] = useState(false)

  const [ownerEmail, setOwnerEmail] = useState(props.pendingOwner?.email ?? '')
  const [inviting, setInviting] = useState(false)
  const [invite, setInvite] = useState<OwnerInviteResult | null>(null)

  const save = async () => {
    const patch: Record<string, unknown> = {}
    if (name.trim() && name.trim() !== props.name) patch.name = name.trim()
    if (status !== props.status) patch.status = status
    if (niche !== (props.niche ?? '')) patch.niche = niche
    if (notes !== (props.notes ?? '')) patch.notes = notes
    if (isSuper && managerUserId !== (props.managerUserId ?? '')) {
      patch.managerUserId = managerUserId
    }
    if (Object.keys(patch).length === 0) {
      toast.message('Nada mudou.')
      return
    }
    if (
      patch.status === 'archived' &&
      !window.confirm(
        'Arquivar este CRM? Ele some para todos os usuários do cliente. Os dados ficam guardados e um super admin pode restaurar.',
      )
    ) {
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/agencia/crms/${props.accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao salvar')
      toast.success('CRM atualizado.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inviteOwner = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    try {
      const res = await fetch(`/api/agencia/crms/${props.accountId}/convite-dono`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao criar o convite')
      setInvite(json.invite)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar o convite')
    } finally {
      setInviting(false)
    }
  }

  const managerName =
    props.operators.find((o) => o.userId === props.managerUserId)?.name ?? null

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
        Gestão do CRM
      </h2>

      <div className="grid gap-6 p-4 lg:grid-cols-2">
        {/* Platform fields */}
        <div className="space-y-4">
          {!props.canEdit && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {props.myRole === 'support'
                ? 'Seu papel (Suporte) só visualiza.'
                : 'Este CRM não está na sua carteira. Só visualização.'}
            </p>
          )}
          <div>
            <Label htmlFor="crm-name" className="text-muted-foreground">
              Nome do CRM
            </Label>
            <Input
              id="crm-name"
              value={name}
              maxLength={120}
              disabled={!props.canEdit}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 border-border bg-muted"
            />
          </div>
          <div>
            <Label htmlFor="crm-status" className="text-muted-foreground">
              Status
            </Label>
            <select
              id="crm-status"
              value={status}
              disabled={!props.canEdit}
              onChange={(e) => setStatus(e.target.value as CrmStatus)}
              className={selectClass}
            >
              {CRM_STATUSES.filter(
                (s) => isSuper || s !== 'archived' || props.status === 'archived',
              ).map((s) => (
                <option key={s} value={s} disabled={!isSuper && props.status === 'archived'}>
                  {CRM_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {CRM_STATUS_DESCRIPTION[status]}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="crm-niche" className="text-muted-foreground">
                Nicho
              </Label>
              <select
                id="crm-niche"
                value={niche}
                disabled={!props.canEdit}
                onChange={(e) => setNiche(e.target.value)}
                className={selectClass}
              >
                <option value="">Sem nicho</option>
                {CRM_NICHES.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
                {/* Keep an unknown stored value selectable instead of
                    silently showing "Sem nicho". */}
                {props.niche && !CRM_NICHES.some((n) => n.id === props.niche) && (
                  <option value={props.niche}>{nicheLabel(props.niche)}</option>
                )}
              </select>
            </div>
            <div>
              <Label htmlFor="crm-manager" className="text-muted-foreground">
                Gestor responsável
              </Label>
              {isSuper ? (
                <select
                  id="crm-manager"
                  value={managerUserId}
                  onChange={(e) => setManagerUserId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Ninguém</option>
                  {props.operators.map((o) => (
                    <option key={o.userId} value={o.userId}>
                      {o.name} · {AGENCIA_ROLE_LABEL[o.role]}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 h-9 rounded-md border border-border px-2 py-2 text-sm">
                  {managerName ?? 'Ninguém'}
                </p>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="crm-notes" className="text-muted-foreground">
              Observações <span className="text-xs">(só a agência vê)</span>
            </Label>
            <Textarea
              id="crm-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              disabled={!props.canEdit}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 border-border bg-muted"
            />
          </div>
          {props.canEdit && (
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Salvar
              </Button>
            </div>
          )}
        </div>

        {/* Owner and consent */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground">Dono</p>
            {props.ownerEmail ? (
              <p className="mt-0.5 font-medium">{props.ownerEmail}</p>
            ) : props.pendingOwner ? (
              <p className="mt-0.5">
                <span className="font-medium">Convite pendente</span> para{' '}
                {props.pendingOwner.email}, até{' '}
                {new Date(props.pendingOwner.expiresAt).toLocaleDateString('pt-BR')}
              </p>
            ) : (
              <p className="mt-0.5 text-muted-foreground">Sem dono e sem convite aberto</p>
            )}
          </div>

          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Acesso da agência (decidido pelo dono)
            </p>
            {props.agencyLevel ? (
              <>
                <p className="mt-0.5 font-medium">{AGENCY_ACCESS_LABEL[props.agencyLevel]}</p>
                <p className="text-xs text-muted-foreground">
                  {AGENCY_ACCESS_DESCRIPTION[props.agencyLevel]}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-muted-foreground">
                Indisponível (exige a migration 049)
              </p>
            )}
            {props.gate && props.agencyLevel && props.status !== 'archived' && (
              <div className="mt-3 border-t border-border pt-3">
                <RequestAccessForm
                  accountId={props.accountId}
                  currentLevel={props.agencyLevel}
                  pending={props.gate.pending}
                  canRequest={props.gate.canRequest}
                  hasOwner={props.gate.hasOwner}
                />
              </div>
            )}
          </div>

          {props.canEdit && props.status !== 'archived' && (
            <form onSubmit={inviteOwner} className="space-y-2">
              <Label htmlFor="owner-email" className="text-muted-foreground">
                {props.ownerEmail ? 'Passar a propriedade para' : 'Convidar o dono'}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="owner-email"
                  type="email"
                  required
                  placeholder="dono@cliente.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="border-border bg-muted"
                />
                <Button type="submit" variant="outline" disabled={inviting}>
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  Gerar convite
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Quem aceitar vira dono. {props.ownerEmail && 'O dono atual continua como administrador. '}
                Convites de dono abertos antes deste param de funcionar.
              </p>
            </form>
          )}
          {invite && <InviteLink invite={invite} />}
        </div>
      </div>
    </section>
  )
}
