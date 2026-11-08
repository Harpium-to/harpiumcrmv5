'use client'

import { useState } from 'react'
import { Check, Copy, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { buildConnectLink, connectMessage, whatsappShareUrl } from '@/lib/agencia/connect-link'

/**
 * Copy or share the link that takes a client straight to the
 * "Conectar com o Facebook" button of their CRM. The console runs on
 * the CRM's own origin, so the link is built from it.
 */
export function ConnectLinkActions({
  accountId,
  crmName,
  emphasize,
}: {
  accountId: string
  crmName: string
  /** Not connected yet: make sending the link the obvious next step. */
  emphasize: boolean
}) {
  const [copied, setCopied] = useState(false)

  function link(): string {
    return buildConnectLink(window.location.origin, accountId)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copie o link:', link())
    }
  }

  function share() {
    window.open(whatsappShareUrl(connectMessage(link(), crmName)), '_blank', 'noopener')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={emphasize ? 'default' : 'outline'} onClick={share}>
        <Send className="size-4" /> Enviar link pelo WhatsApp
      </Button>
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'Link copiado' : 'Copiar link de conexão'}
      </Button>
    </div>
  )
}
