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

/** Send a plain text message. `toPhone` should be digits only. */
export async function sendUazapiText(
  srv: UazapiServer,
  toPhone: string,
  text: string,
): Promise<{ externalId: string | null }> {
  const res = await fetch(endpoint(srv.baseUrl, 'send/text'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: srv.token },
    body: JSON.stringify({ number: toPhone, text }),
  })
  // Never retry a send automatically — the gateway may have delivered it.
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
