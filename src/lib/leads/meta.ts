// ============================================================
// Meta (Facebook/Instagram) Lead Ads — Graph API helpers for the native
// integration. Network calls live here; the routes stay thin.
//
// Flow: admin connects via OAuth → we list their Pages, store each Page
// access token, and subscribe the Page to our app's `leadgen` webhook.
// When a lead arrives, the webhook fetches its field_data with the stored
// Page token and runs the shared ingestLead.
// ============================================================

const META_API_VERSION = 'v21.0'
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`

// Scopes needed to list Pages, subscribe the app to a Page's leadgen
// events, and retrieve the lead data. `business_management` is required
// to manage Pages owned by client Business Managers (agency case).
export const META_LEAD_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'leads_retrieval',
  'business_management',
].join(',')

export function metaAppId(): string | null {
  return process.env.META_APP_ID || null
}

/** Facebook Login dialog URL to start the connect flow. */
export function buildOAuthUrl(params: {
  appId: string
  redirectUri: string
  state: string
}): string {
  const q = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    state: params.state,
    response_type: 'code',
    scope: META_LEAD_SCOPES,
  })
  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${q.toString()}`
}

async function graphError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.error?.message ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/** Exchange an OAuth `code` for a (short-lived) user access token. */
export async function exchangeCodeForToken(params: {
  appId: string
  appSecret: string
  redirectUri: string
  code: string
}): Promise<string> {
  const q = new URLSearchParams({
    client_id: params.appId,
    client_secret: params.appSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  })
  const res = await fetch(`${GRAPH}/oauth/access_token?${q.toString()}`)
  if (!res.ok) throw new Error(`Falha na troca de token: ${await graphError(res)}`)
  const j = await res.json()
  if (!j.access_token) throw new Error('A troca de token não devolveu access_token')
  return j.access_token as string
}

export interface MetaPage {
  id: string
  name: string
  accessToken: string
}

/** List the Pages the connected user can manage, with per-Page tokens. */
export async function fetchPages(userToken: string): Promise<MetaPage[]> {
  const pages: MetaPage[] = []
  let url: string | null =
    `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`
  // Follow paging.next so accounts with many Pages come through in full.
  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) throw new Error(`Falha ao buscar as páginas: ${await graphError(res)}`)
    const j = await res.json()
    for (const p of j.data ?? []) {
      if (p.id && p.access_token) {
        pages.push({ id: p.id, name: p.name ?? p.id, accessToken: p.access_token })
      }
    }
    url = j.paging?.next ?? null
  }
  return pages
}

/** Subscribe our app to the Page's `leadgen` field. */
export async function subscribePageLeadgen(
  pageId: string,
  pageToken: string,
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscribed_fields: 'leadgen',
      access_token: pageToken,
    }),
  })
  if (!res.ok) {
    console.error('[meta] subscribe leadgen failed:', await graphError(res))
    return false
  }
  const j = await res.json()
  return Boolean(j.success)
}

/**
 * Fetch a single lead's data. Returns the raw Meta payload in the same
 * shape normalizeLead expects (`field_data` array), plus campaign/form.
 */
export async function fetchLead(
  leadgenId: string,
  pageToken: string,
): Promise<Record<string, unknown>> {
  const fields = 'id,created_time,ad_id,form_id,campaign_name,field_data'
  const res = await fetch(
    `${GRAPH}/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(pageToken)}`,
  )
  if (!res.ok) throw new Error(`Falha ao buscar o lead: ${await graphError(res)}`)
  return (await res.json()) as Record<string, unknown>
}
