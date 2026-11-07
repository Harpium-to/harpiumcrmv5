'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

export interface OwnerInviteResult {
  url: string | null
  path: string
  email: string
  expiresAt: string
}

/**
 * The owner-invitation link, shown once right after it is created. The
 * token is never stored in plaintext, so this is the only chance to
 * copy it — the invitee also finds it inside the app by logging in
 * with the invited email.
 */
export function InviteLink({ invite }: { invite: OwnerInviteResult }) {
  const [copied, setCopied] = useState(false)
  const url =
    invite.url ??
    (typeof window !== 'undefined' ? `${window.location.origin}${invite.path}` : invite.path)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não consegui copiar. Selecione o link e copie à mão.')
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-medium">Convite do dono criado</p>
      <p className="text-xs text-muted-foreground">
        Envie este link para <strong className="text-foreground">{invite.email}</strong>.
        Ele só funciona para esse e-mail e vale até{' '}
        {new Date(invite.expiresAt).toLocaleDateString('pt-BR')}. Se a pessoa já
        tiver conta, ela também vê o convite ao entrar no sistema.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {url}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Este link não aparece de novo. Se perder, gere outro na página do CRM.
      </p>
    </div>
  )
}
