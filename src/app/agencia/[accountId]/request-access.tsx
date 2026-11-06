'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AGENCY_ACCESS_DESCRIPTION, type AgencyAccessLevel } from '@/lib/agencia/crm'
import { describeRequest, type PendingAccessRequest } from '@/lib/agencia/consent'

const DURATIONS: { label: string; hours: number | null }[] = [
  { label: 'Permanente', hours: null },
  { label: '24 horas', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '7 dias', hours: 168 },
]

const selectClass =
  'mt-1 h-9 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground'

/**
 * Ask the CRM owner for more access. The owner gets a notification
 * and answers in their settings; nothing changes until they do.
 */
export function RequestAccessForm({
  accountId,
  currentLevel,
  pending,
  canRequest,
  hasOwner,
}: {
  accountId: string
  currentLevel: AgencyAccessLevel | null
  pending: PendingAccessRequest | null
  canRequest: boolean
  hasOwner: boolean
}) {
  const router = useRouter()
  const levels: ('read' | 'full')[] = currentLevel === 'read' ? ['full'] : ['read', 'full']
  const [level, setLevel] = useState<'read' | 'full'>(levels[0])
  const [hours, setHours] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)

  if (currentLevel === 'full') return null

  if (!hasOwner) {
    return (
      <p className="text-xs text-muted-foreground">
        Este CRM ainda não tem dono para liberar acesso. Assim que o convite de
        dono for aceito, dá para pedir.
      </p>
    )
  }

  const pendingNote = pending && (
    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        Pedido enviado: {describeRequest(pending.level, pending.tempHours)}.
      </span>{' '}
      Aguardando o dono responder desde{' '}
      {new Date(pending.createdAt).toLocaleDateString('pt-BR')}.
    </p>
  )

  if (!canRequest) {
    return (
      <div className="space-y-2">
        {pendingNote}
        <p className="text-xs text-muted-foreground">
          Para pedir acesso, fale com um super admin ou com o gestor deste CRM.
        </p>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    try {
      const res = await fetch(`/api/agencia/crms/${accountId}/pedido-acesso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, hours, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Falha ao enviar o pedido')
      toast.success('Pedido enviado ao dono do CRM.')
      setReason('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar o pedido')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {pendingNote}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="req-level" className="text-muted-foreground">
            Nível
          </Label>
          <select
            id="req-level"
            value={level}
            onChange={(e) => setLevel(e.target.value === 'full' ? 'full' : 'read')}
            className={selectClass}
          >
            {levels.map((l) => (
              <option key={l} value={l}>
                {l === 'full' ? 'Total' : 'Leitura'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="req-hours" className="text-muted-foreground">
            Por quanto tempo
          </Label>
          <select
            id="req-hours"
            value={hours === null ? '' : String(hours)}
            onChange={(e) => setHours(e.target.value === '' ? null : Number(e.target.value))}
            className={selectClass}
          >
            {DURATIONS.map((d) => (
              <option key={d.label} value={d.hours === null ? '' : String(d.hours)}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{AGENCY_ACCESS_DESCRIPTION[level]}</p>
      <div>
        <Label htmlFor="req-reason" className="text-muted-foreground">
          Motivo <span className="text-xs">(o dono lê)</span>
        </Label>
        <Textarea
          id="req-reason"
          rows={2}
          maxLength={500}
          placeholder="ex.: configurar as automações de lembrete de consulta"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 border-border bg-muted"
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={sending}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {pending ? 'Enviar novo pedido' : 'Pedir acesso ao dono'}
        </Button>
      </div>
    </form>
  )
}
