import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Paperclip } from 'lucide-react'

import { requireAgencia } from '@/lib/agencia/guard'
import {
  getConversationThread,
  logAgenciaAccess,
  type ThreadMessage,
} from '@/lib/agencia/queries'

export const dynamic = 'force-dynamic'

export default async function AgenciaConversationPage({
  params,
}: {
  params: Promise<{ accountId: string; conversationId: string }>
}) {
  const { accountId, conversationId } = await params
  const { admin, userId } = await requireAgencia()
  const thread = await getConversationThread(admin, accountId, conversationId)
  if (!thread) notFound()

  // Audit this privileged view of a client's conversation.
  await logAgenciaAccess(admin, {
    actorUserId: userId,
    action: 'view_conversation',
    accountId,
    conversationId,
  })

  const { conversation, contact, messages } = thread
  const title = contact?.name ?? contact?.phone ?? 'Conversa'

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/agencia/${accountId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para a conta
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{title}</h1>
            {contact && (
              <p className="text-sm text-muted-foreground">
                {contact.phone}
                {contact.email ? ` · ${contact.email}` : ''}
              </p>
            )}
          </div>
          <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {conversation.status}
          </span>
        </div>
      </div>

      {/* Read-only banner — the agency console never sends. */}
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Visualização somente-leitura para análise. A agência não responde por aqui.
      </p>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma mensagem nesta conversa.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  // customer = inbound (left); agent/bot = outbound (right).
  const inbound = message.senderType === 'customer'

  return (
    <div className={inbound ? 'flex justify-start' : 'flex justify-end'}>
      <div
        className={[
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
          inbound
            ? 'rounded-tl-sm bg-muted text-foreground'
            : 'rounded-tr-sm bg-primary/10 text-foreground',
        ].join(' ')}
      >
        <MessageBody message={message} />
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{senderLabel(message.senderType)}</span>
          <span>·</span>
          <time>{formatTime(message.createdAt)}</time>
          {!inbound && (
            <>
              <span>·</span>
              <span>{message.status}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBody({ message }: { message: ThreadMessage }) {
  if (message.contentType === 'template') {
    return (
      <p className="italic text-muted-foreground">
        Template: {message.templateName ?? '—'}
        {message.contentText ? ` — ${message.contentText}` : ''}
      </p>
    )
  }

  if (message.contentType !== 'text' && message.mediaUrl) {
    return (
      <a
        href={message.mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-primary hover:underline"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {mediaLabel(message.contentType)}
      </a>
    )
  }

  if (message.contentText) {
    return <p className="whitespace-pre-wrap break-words">{message.contentText}</p>
  }

  return <p className="italic text-muted-foreground">({message.contentType})</p>
}

function senderLabel(t: ThreadMessage['senderType']): string {
  switch (t) {
    case 'customer':
      return 'Cliente'
    case 'agent':
      return 'Atendente'
    case 'bot':
      return 'Bot'
  }
}

function mediaLabel(contentType: string): string {
  switch (contentType) {
    case 'image':
      return 'Imagem'
    case 'document':
      return 'Documento'
    case 'audio':
      return 'Áudio'
    case 'video':
      return 'Vídeo'
    case 'location':
      return 'Localização'
    default:
      return 'Anexo'
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
