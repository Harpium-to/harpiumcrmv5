// ============================================================
// UAZAPI HTTP calls.
//
// Two token scopes, both sent as plain headers (never Authorization):
//   - `admintoken` — server scope. Creates instances. Stays server-side.
//   - `token`      — instance scope. Pairing, status, send, webhook.
//
// The base URL is per-account: UAZAPI has no single public host, each
// operator points at the server hosting their instances.
// ============================================================

export interface UazapiServer {
  baseUrl: string
  token: string // instance token
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** Shared error shaping: UAZAPI puts the human message in a few places. */
async function failure(res: Response, what: string): Promise<never> {
  let detail = `HTTP ${res.status}`
  try {
    const j = await res.json()
    detail = j?.message_ptbr ?? j?.error ?? j?.message ?? detail
  } catch {
    /* keep status */
  }
  throw new Error(`${what}: ${detail}`)
}

/**
 * Mint a new instance on the server. Returns the instance token, which
 * is what every later call uses — the admin token is not needed again.
 */
export async function createUazapiInstance(
  baseUrl: string,
  adminToken: string,
  name: string,
): Promise<{ token: string; instanceName: string }> {
  const res = await fetch(endpoint(baseUrl, 'instance/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', admintoken: adminToken },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) await failure(res, 'Falha ao criar instância')
  const j = await res.json().catch(() => ({}))
  // The token comes back at the top level and, redundantly, nested.
  const token =
    typeof j?.token === 'string'
      ? j.token
      : typeof j?.instance?.token === 'string'
        ? j.instance.token
        : null
  if (!token) throw new Error('A UAZAPI não devolveu o token da instância.')
  const instanceName =
    typeof j?.instance?.name === 'string' ? j.instance.name : name
  return { token, instanceName }
}

/**
 * Start the pairing flow. With no phone this yields a QR code; with one
 * it yields a numeric pairing code instead. The QR itself is NOT in this
 * response — poll `getUazapiStatus` for it (see the status schema).
 */
export async function connectUazapiInstance(
  srv: UazapiServer,
  phone?: string,
): Promise<void> {
  const res = await fetch(endpoint(srv.baseUrl, 'instance/connect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify(phone ? { phone } : {}),
  })
  // 409 means a pairing flow is already running — harmless, the status
  // poll will pick up its QR.
  if (!res.ok && res.status !== 409) await failure(res, 'Falha ao iniciar conexão')
}

export interface UazapiStatus {
  /** disconnected | connecting | connected | hibernated */
  status: string
  connected: boolean
  loggedIn: boolean
  /** data: URI PNG while pairing, else null. */
  qrcode: string | null
  paircode: string | null
  phone: string | null
  profileName: string | null
}

/** Current pairing/connection state, including the QR while connecting. */
export async function getUazapiStatus(srv: UazapiServer): Promise<UazapiStatus> {
  const res = await fetch(endpoint(srv.baseUrl, 'instance/status'), {
    headers: { token: srv.token },
  })
  if (!res.ok) await failure(res, 'Falha ao consultar status')
  const j = await res.json().catch(() => ({}))
  const inst = j?.instance ?? {}
  const st = j?.status ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    status: str(inst.status) ?? 'disconnected',
    connected: st.connected === true,
    loggedIn: st.loggedIn === true,
    qrcode: str(inst.qrcode),
    paircode: str(inst.paircode),
    // jid.user is the paired number once connected.
    phone: str(st?.jid?.user) ?? str(inst.owner),
    profileName: str(inst.profileName),
  }
}

/**
 * Point the instance's webhook at our inbound URL.
 *
 * `excludeMessages: ['wasSentByApi']` is deliberate: it drops the echo of
 * what WE send (which would otherwise be ingested a second time) while
 * still delivering messages the operator types on their own phone — those
 * are `fromMe` but not `wasSentByApi`, and we do want them in the thread.
 */
export async function setUazapiWebhook(
  srv: UazapiServer,
  url: string,
): Promise<void> {
  const res = await fetch(endpoint(srv.baseUrl, 'webhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify({
      enabled: true,
      url,
      events: ['messages', 'connection'],
      excludeMessages: ['wasSentByApi'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    }),
  })
  if (!res.ok) await failure(res, 'Falha ao configurar webhook')
}

/** End the WhatsApp session on the phone. Reconnecting needs a new QR. */
export async function disconnectUazapiInstance(srv: UazapiServer): Promise<void> {
  const res = await fetch(endpoint(srv.baseUrl, 'instance/disconnect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify({}),
  })
  if (!res.ok) await failure(res, 'Falha ao desconectar')
}

/**
 * POST one send and read back the WhatsApp message id.
 *
 * Never retried automatically — a timeout leaves the result unknown and
 * the gateway may already have delivered it (UAZAPI's own guidance).
 */
async function postSend(
  srv: UazapiServer,
  path: string,
  body: Record<string, unknown>,
): Promise<{ externalId: string | null }> {
  const res = await fetch(endpoint(srv.baseUrl, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify(body),
  })
  if (!res.ok) await failure(res, 'Falha ao enviar')
  const j = await res.json().catch(() => ({}))
  const externalId =
    typeof j?.messageid === 'string'
      ? j.messageid
      : typeof j?.id === 'string'
        ? j.id
        : null
  return { externalId }
}

/** Send a plain text message. `toPhone` should be digits only. */
export async function sendUazapiText(
  srv: UazapiServer,
  toPhone: string,
  text: string,
  opts: { replyId?: string | null } = {},
): Promise<{ externalId: string | null }> {
  return postSend(srv, 'send/text', {
    number: toPhone,
    text,
    ...(opts.replyId ? { replyid: opts.replyId } : {}),
  })
}

/**
 * UAZAPI's media types for ours. Audio from the inbox is always a voice
 * note recorded in the composer, so it goes as `ptt` and arrives as a
 * voice message, not as a file.
 */
export const UAZAPI_MEDIA_TYPE = {
  image: 'image',
  video: 'video',
  document: 'document',
  audio: 'ptt',
} as const

export type UazapiMediaKind = keyof typeof UAZAPI_MEDIA_TYPE

/** Send an image, video, document or voice note by public URL. */
export async function sendUazapiMedia(
  srv: UazapiServer,
  toPhone: string,
  media: {
    kind: UazapiMediaKind
    url: string
    caption?: string | null
    filename?: string | null
    replyId?: string | null
  },
): Promise<{ externalId: string | null }> {
  return postSend(srv, 'send/media', {
    number: toPhone,
    type: UAZAPI_MEDIA_TYPE[media.kind],
    file: media.url,
    ...(media.caption ? { text: media.caption } : {}),
    ...(media.kind === 'document' && media.filename ? { docName: media.filename } : {}),
    ...(media.replyId ? { replyid: media.replyId } : {}),
  })
}

export interface UazapiMenu {
  type: 'button' | 'list'
  text: string
  choices: string[]
  footerText?: string
  listButton?: string
}

/** Send reply buttons or a list (see `menuFromInteractive`). */
export async function sendUazapiMenu(
  srv: UazapiServer,
  toPhone: string,
  menu: UazapiMenu,
  opts: { replyId?: string | null } = {},
): Promise<{ externalId: string | null }> {
  return postSend(srv, 'send/menu', {
    number: toPhone,
    ...menu,
    ...(opts.replyId ? { replyid: opts.replyId } : {}),
  })
}

/**
 * A temporary public link to the file of a received media message.
 *
 * UAZAPI keeps it on its CDN for 2 days only, so callers copy the file
 * into our own storage. Audio comes back as MP3, which every browser
 * plays (Safari can't play the OGG voice notes WhatsApp records).
 */
export async function downloadUazapiMedia(
  srv: UazapiServer,
  messageId: string,
): Promise<{ fileUrl: string; mimetype: string | null } | null> {
  const res = await fetch(endpoint(srv.baseUrl, 'message/download'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify({ id: messageId, return_link: true, generate_mp3: true }),
  })
  if (!res.ok) await failure(res, 'Falha ao baixar a mídia')
  const j = await res.json().catch(() => ({}))
  const fileUrl = typeof j?.fileURL === 'string' && j.fileURL ? j.fileURL : null
  if (!fileUrl) return null
  return { fileUrl, mimetype: typeof j?.mimetype === 'string' ? j.mimetype : null }
}

// ------------------------------------------------------------
// History: what the phone sent to the instance when it paired (UAZAPI
// keeps ~90 days by default). Used by the "bring the old chats" import.
// ------------------------------------------------------------

export interface UazapiChatPage {
  chats: Record<string, unknown>[]
  /** Offset of the next page, or null when this was the last. */
  nextOffset: number | null
}

/** One page of 1:1 chats, most recent conversation first. */
export async function findUazapiChats(
  srv: UazapiServer,
  page: { limit: number; offset: number },
): Promise<UazapiChatPage> {
  const res = await fetch(endpoint(srv.baseUrl, 'chat/find'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify({
      operator: 'AND',
      sort: '-wa_lastMsgTimestamp',
      limit: page.limit,
      offset: page.offset,
      compact: true,
      wa_isGroup: false,
    }),
  })
  if (!res.ok) await failure(res, 'Falha ao buscar as conversas')
  const j = await res.json().catch(() => ({}))
  const chats = Array.isArray(j?.chats) ? (j.chats as Record<string, unknown>[]) : []
  const total = Number(j?.pagination?.totalRecords)
  const next = page.offset + chats.length
  const more = Number.isFinite(total) ? next < total : chats.length === page.limit
  return { chats, nextOffset: more && chats.length > 0 ? next : null }
}

/** The most recent messages of one chat (newest first, as UAZAPI returns them). */
export async function findUazapiMessages(
  srv: UazapiServer,
  chatid: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(endpoint(srv.baseUrl, 'message/find'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify({ chatid, limit, offset: 0 }),
  })
  if (!res.ok) await failure(res, 'Falha ao buscar as mensagens')
  const j = await res.json().catch(() => ({}))
  return Array.isArray(j?.messages) ? (j.messages as Record<string, unknown>[]) : []
}
