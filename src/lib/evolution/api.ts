// Evolution API HTTP calls. Self-hosted server, so the base URL is
// per-account. Auth is the `apikey` header.

export interface EvolutionCreds {
  baseUrl: string
  apiKey: string
  instance: string
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** Send a plain text message. `toPhone` should be digits only. */
export async function sendEvolutionText(
  creds: EvolutionCreds,
  toPhone: string,
  text: string,
): Promise<{ externalId: string | null }> {
  const res = await fetch(
    endpoint(creds.baseUrl, `message/sendText/${encodeURIComponent(creds.instance)}`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
      body: JSON.stringify({ number: toPhone, text }),
    },
  )
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.message ?? j?.error ?? detail
    } catch {
      /* keep status */
    }
    throw new Error(`Evolution send failed: ${detail}`)
  }
  const j = await res.json().catch(() => ({}))
  const externalId =
    typeof j?.key?.id === 'string' ? j.key.id : typeof j?.id === 'string' ? j.id : null
  return { externalId }
}

/** Quick connectivity/credentials probe used by the config UI. */
export async function checkEvolutionInstance(
  creds: EvolutionCreds,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(
      endpoint(creds.baseUrl, `instance/connectionState/${encodeURIComponent(creds.instance)}`),
      { headers: { apikey: creds.apiKey } },
    )
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'network error' }
  }
}
