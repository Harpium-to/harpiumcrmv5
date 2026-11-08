// ============================================================
// The "Enviar link de conexão" link (W2).
//
// The agency sends it to a client; the client opens it logged in to
// the CRM and lands on Settings › WhatsApp with the "Conectar com o
// Facebook" button highlighted. `crm` makes the link work for someone
// who belongs to several CRMs: the page switches to that one first.
// ============================================================

/** Query params the CRM side reads. Kept here so both ends agree. */
export const CONNECT_PARAM = 'conectar'
export const CONNECT_CRM_PARAM = 'crm'

/** `origin` is the CRM's public origin, e.g. https://harpium-crm.netlify.app */
export function buildConnectLink(origin: string, accountId: string): string {
  const url = new URL('/settings', origin)
  url.searchParams.set('tab', 'whatsapp')
  url.searchParams.set(CONNECT_PARAM, '1')
  url.searchParams.set(CONNECT_CRM_PARAM, accountId)
  return url.toString()
}

/** The message that goes with the link when sent over WhatsApp. */
export function connectMessage(link: string, crmName?: string | null): string {
  const target = crmName ? ` ao CRM ${crmName}` : ' ao CRM'
  return [
    `Olá! Para ligar o WhatsApp da sua empresa${target}, abra este link com o seu login e clique em "Conectar com o Facebook":`,
    link,
    'Leva uns 3 minutos. Tenha em mãos o celular do número que vai usar, para receber o código.',
  ].join('\n\n')
}

/** wa.me share link: opens WhatsApp with the message ready to send. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export interface ConnectIntent {
  /** Highlight the connect button. */
  highlight: boolean
  /** Switch to this CRM first; null when already on it or not asked. */
  switchTo: string | null
}

/**
 * What a settings URL asks for, given the CRM the user has open.
 * Only a well-formed id is honoured — the value goes to an API call.
 */
export function readConnectIntent(
  params: Pick<URLSearchParams, 'get'>,
  activeAccountId: string | null | undefined,
): ConnectIntent {
  const highlight = params.get(CONNECT_PARAM) === '1'
  const raw = params.get(CONNECT_CRM_PARAM)
  const wanted = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null
  return {
    highlight,
    switchTo: wanted && activeAccountId && wanted !== activeAccountId ? wanted : null,
  }
}
