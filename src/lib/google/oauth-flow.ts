// ============================================================
// Shared bits of the "Conectar com o Google" round trip (G1): the
// cookie that ties Google's answer to the browser that asked, and the
// address the person lands on afterwards.
// ============================================================

/** httpOnly cookie holding the state of the sign-in in flight. */
export const GOOGLE_STATE_COOKIE = 'google_oauth_state'

/** How long a sign-in may take, in seconds (the request row says 15 min too). */
export const GOOGLE_STATE_MAX_AGE = 15 * 60

/**
 * What the Agenda screen is told when the person comes back, as
 * `/agenda?google=<result>`. The screen turns it into a sentence
 * (googleResultMessage below).
 */
export type GoogleConnectResult =
  | 'conectado'
  | 'negado'
  | 'permissao'
  | 'expirado'
  | 'config'
  | 'indisponivel'
  | 'sem-permissao'
  | 'link-invalido'
  | 'erro'

export function agendaReturnUrl(
  origin: string,
  result: GoogleConnectResult,
  calendarId?: string | null,
): string {
  const url = new URL('/agenda', origin)
  url.searchParams.set('google', result)
  if (calendarId) url.searchParams.set('agenda', calendarId)
  return url.toString()
}

/** The toast the Agenda shows for each result; `ok` picks its colour. */
export function googleResultMessage(result: string | null): { ok: boolean; text: string } | null {
  switch (result) {
    case 'conectado':
      return { ok: true, text: 'Google Agenda conectado. Os agendamentos de hoje em diante vão para lá.' }
    case 'negado':
      return { ok: false, text: 'A conexão com o Google foi cancelada. Nada mudou.' }
    case 'permissao':
      return {
        ok: false,
        text: 'Faltou permitir que o CRM veja e edite os eventos. Conecte de novo e deixe essa opção marcada.',
      }
    case 'expirado':
      return { ok: false, text: 'O pedido de conexão expirou. Clique em Conectar com o Google de novo.' }
    case 'config':
      return { ok: false, text: 'O Google ainda não está configurado neste servidor. Fale com a Harpium.' }
    case 'indisponivel':
      return {
        ok: false,
        text: 'A ligação com o Google Agenda ainda não foi ativada neste CRM (falta aplicar a atualização do banco).',
      }
    case 'sem-permissao':
      return { ok: false, text: 'Só administradores do CRM conectam o Google Agenda.' }
    case 'link-invalido':
      return { ok: false, text: 'Esse link de conexão já foi usado ou expirou. Gere um novo na engrenagem da Agenda.' }
    case 'erro':
      return { ok: false, text: 'Não consegui conectar ao Google agora. Tente de novo em instantes.' }
    default:
      return null
  }
}

/**
 * Where a sign-in started from a professional's link (G3) lands: nobody
 * is signed in to the CRM there, so not the Agenda.
 */
export function professionalReturnUrl(origin: string, result: GoogleConnectResult): string {
  const url = new URL('/conectar-google/pronto', origin)
  url.searchParams.set('google', result)
  return url.toString()
}

/** What the professional reads on /conectar-google/pronto. */
export function professionalResultMessage(result: string | null): { ok: boolean; title: string; text: string } {
  switch (result) {
    case 'conectado':
      return {
        ok: true,
        title: 'Google Agenda conectado',
        text: 'Pronto: os agendamentos marcados para você no CRM vão aparecer no seu Google Agenda. Pode fechar esta página.',
      }
    case 'negado':
      return { ok: false, title: 'Conexão cancelada', text: 'Nada foi conectado. Se quiser, abra o link de novo.' }
    case 'permissao':
      return {
        ok: false,
        title: 'Faltou uma permissão',
        text: 'Para funcionar, o CRM precisa ver e editar os eventos da sua agenda. Abra o link de novo e deixe essa opção marcada.',
      }
    case 'link-invalido':
      return {
        ok: false,
        title: 'Link expirado',
        text: 'Este link já foi usado ou passou de 7 dias. Peça um link novo para quem te enviou.',
      }
    case 'expirado':
      return { ok: false, title: 'O tempo acabou', text: 'A conexão demorou demais. Abra o link de novo.' }
    case 'config':
      return { ok: false, title: 'Indisponível', text: 'A conexão com o Google ainda não está ativada. Avise quem te enviou o link.' }
    default:
      return { ok: false, title: 'Não deu certo', text: 'Não consegui conectar agora. Tente abrir o link de novo em instantes.' }
  }
}

/** A Postgres uuid, as the routes accept it from the outside. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
