// ============================================================
// The Harpium's own UAZAPI server (D1).
//
// The Harpium contracts one server and keeps its address and admin
// token in the environment (UAZAPI_BASE_URL, UAZAPI_ADMIN_TOKEN). A
// client on the unofficial path then only reads a QR code: the CRM
// mints an instance on this server, wires the webhook and pairs —
// exactly as on the official path, where the Harpium already did the
// Meta app once for everybody.
//
// The admin token never goes to the database: a CRM's row stores the
// server address and the instance token it was given, nothing that
// could create instances. Without the variables the hosted mode is
// off and the manual form (address + tokens) is the only way, as
// before.
// ============================================================

export interface HostedUazapi {
  baseUrl: string
  adminToken: string
}

export function hostedUazapi(
  env: Record<string, string | undefined> = process.env,
): HostedUazapi | null {
  const baseUrl = env.UAZAPI_BASE_URL?.trim().replace(/\/+$/, '')
  const adminToken = env.UAZAPI_ADMIN_TOKEN?.trim()
  if (!baseUrl || !adminToken) return null
  return { baseUrl, adminToken }
}

/** True when a CRM's instance lives on the Harpium's server. */
export function isHostedBaseUrl(baseUrl: string | null | undefined, hosted: HostedUazapi | null): boolean {
  if (!hosted || !baseUrl) return false
  return baseUrl.replace(/\/+$/, '') === hosted.baseUrl
}
