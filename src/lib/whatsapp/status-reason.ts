// ============================================================
// Why Meta cut a WhatsApp connection (account_update webhook, W3).
// Stored as a code in whatsapp_config.status_reason; this is the one
// place that turns it into words, for the client's status screen and
// for the agency console.
// ============================================================

export type StatusReason = 'partner_removed' | 'account_offboarded'

const MESSAGES: Record<StatusReason, string> = {
  partner_removed:
    'A empresa removeu o acesso do CRM ao WhatsApp nas configurações da Meta. Conecte de novo para voltar a receber as mensagens.',
  account_offboarded:
    'O número deixou de estar conectado junto com o app WhatsApp Business (o app foi reinstalado, trocado de celular ou desconectado). Conecte de novo.',
}

export function isStatusReason(value: unknown): value is StatusReason {
  return value === 'partner_removed' || value === 'account_offboarded'
}

/** Plain-language reason, or null for a code we don't know. */
export function statusReasonMessage(value: unknown): string | null {
  return isStatusReason(value) ? MESSAGES[value] : null
}
