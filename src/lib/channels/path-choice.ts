import { isWhatsAppPath, WHATSAPP_RISK_TERMS_VERSION, type WhatsAppPath } from './whatsapp-route'

// ============================================================
// The rules for choosing a CRM's WhatsApp path (D1). Pure, so they are
// tested apart from the route that applies them.
// ============================================================

export type PathChoiceCheck =
  | { ok: true; path: WhatsAppPath; riskTermsVersion: string | null }
  | { ok: false; status: number; error: string }

export function checkPathChoice(input: {
  path: unknown
  acceptRisk: unknown
  termsVersion: unknown
  viaAgency: boolean
}): PathChoiceCheck {
  if (!isWhatsAppPath(input.path)) {
    return { ok: false, status: 400, error: 'Escolha o caminho: oficial ou não oficial.' }
  }
  if (input.path === 'oficial') {
    return { ok: true, path: 'oficial', riskTermsVersion: null }
  }
  // The number at risk is the client's: the agency can explain it, but
  // only someone of the CRM can accept it.
  if (input.viaAgency) {
    return {
      ok: false,
      status: 403,
      error:
        'Só alguém do CRM pode aceitar o risco do WhatsApp não oficial. Peça ao dono ou a um administrador do cliente.',
    }
  }
  if (input.acceptRisk !== true) {
    return {
      ok: false,
      status: 400,
      error: 'Para usar o WhatsApp não oficial, confirme que entende o risco de bloqueio do número.',
    }
  }
  // An acceptance of an older text is no acceptance of the current one:
  // the screen was loaded before the wording changed. Reload and read.
  if (input.termsVersion !== WHATSAPP_RISK_TERMS_VERSION) {
    return {
      ok: false,
      status: 409,
      error: 'O texto sobre o risco mudou. Recarregue a página e leia de novo antes de confirmar.',
    }
  }
  return { ok: true, path: 'nao_oficial', riskTermsVersion: WHATSAPP_RISK_TERMS_VERSION }
}
