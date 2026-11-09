import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

import type { WhatsAppDetail, WhatsAppState } from '@/lib/agencia/whatsapp'
import { ConnectLinkActions } from './connect-link-actions'

const STATE_LABEL: Record<WhatsAppState, string> = {
  connected: 'Conectado',
  attention: 'Precisa de atenção',
  none: 'Não conectado',
}

const STATE_CLASS: Record<WhatsAppState, string> = {
  connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  attention: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  none: 'bg-muted text-muted-foreground',
}

const QUALITY_LABEL: Record<string, string> = {
  GREEN: 'Alta',
  YELLOW: 'Média',
  RED: 'Baixa',
}

/**
 * WhatsApp of one client CRM, in the agency console (W2): whether it
 * is connected, what to fix when it isn't, and the link that lets the
 * client connect it themselves.
 */
export function WhatsAppCard({
  accountId,
  crmName,
  detail,
  canSendLink,
}: {
  accountId: string
  crmName: string
  detail: WhatsAppDetail
  /** Archived CRMs don't get new connections. */
  canSendLink: boolean
}) {
  const { state, reason, phone, lastInboundAt, detailsAllowed, coexistence } = detail
  const unofficial = detail.path === 'nao_oficial'

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          WhatsApp{' '}
          <span className="font-normal text-muted-foreground">
            · {unofficial ? 'não oficial (QR code)' : 'oficial (API da Meta)'}
          </span>
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}>
          {STATE_LABEL[state]}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {reason && <p className="text-sm text-muted-foreground">{reason}</p>}

        {unofficial && (
          <p className="text-xs text-muted-foreground">
            O cliente escolheu a conexão por QR code: o número pode ser bloqueado pelo WhatsApp,
            principalmente com envio em massa. O aceite desse risco fica registrado no CRM.
          </p>
        )}

        {coexistence && state !== 'none' && (
          <p className="text-xs text-muted-foreground">
            Conectado junto com o app WhatsApp Business: o cliente continua usando o celular, e as
            respostas que ele manda de lá também aparecem no CRM.
          </p>
        )}

        {detailsAllowed && phone && (
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <Item label="Número" value={phone.displayPhoneNumber} />
            <Item label="Nome no WhatsApp" value={phone.verifiedName ?? '—'} />
            {/* The quality rating is Meta's; a QR-code number has none. */}
            {!unofficial && (
              <Item
                label="Qualidade"
                value={
                  phone.qualityRating
                    ? QUALITY_LABEL[phone.qualityRating.toUpperCase()] ?? phone.qualityRating
                    : 'Sem avaliação'
                }
              />
            )}
            <Item
              label="Última mensagem recebida"
              value={
                lastInboundAt
                  ? formatDistanceToNow(new Date(lastInboundAt), { addSuffix: true, locale: ptBR })
                  : 'nenhuma ainda'
              }
            />
          </dl>
        )}

        {!detailsAllowed && state !== 'none' && (
          <p className="text-xs text-muted-foreground">
            O número e as últimas mensagens aparecem aqui quando o cliente libera acesso de
            leitura para a agência.
          </p>
        )}

        {canSendLink && state !== 'connected' && (
          <div className="space-y-2">
            {unofficial ? (
              <p className="text-sm">
                Mande para o cliente o link de conexão: ele entra com o login dele e lê o{' '}
                <strong>QR code</strong> com o celular do número.
              </p>
            ) : (
              <p className="text-sm">
                Mande para o cliente o link de conexão: ele entra com o login dele, clica em{' '}
                <strong>Conectar com o Facebook</strong> e escolhe o número.
              </p>
            )}
            <ConnectLinkActions accountId={accountId} crmName={crmName} emphasize />
          </div>
        )}

        {canSendLink && state === 'connected' && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Precisa trocar o número? Enviar link de conexão
            </summary>
            <div className="mt-2">
              <ConnectLinkActions accountId={accountId} crmName={crmName} emphasize={false} />
            </div>
          </details>
        )}
      </div>
    </section>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
