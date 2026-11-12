// ============================================================
// "Is this CRM's WhatsApp connected?" for the screens — pure.
//
// The inbox banner and the settings overview used to read only the
// official API's row (whatsapp_config). A CRM on the unofficial path
// (QR code, UAZAPI) has no such row, so they said "not connected"
// while the QR-code number was paired and receiving. This reads the
// answer of GET /api/whatsapp/path instead: on the unofficial path it
// decides here; on the official path (or before any choice) it
// returns null and the screen keeps its own official-API check.
// ============================================================

/** The fields of GET /api/whatsapp/path this needs. */
export interface WhatsAppPathInfo {
  effectivePath?: 'oficial' | 'nao_oficial' | null
  provider?: 'meta' | 'uazapi' | 'evolution' | null
  naoOficial?: {
    configured?: boolean
    status?: string | null
    evolution?: boolean
  }
}

export interface ConnectionSummary {
  /** A number was set up on this path (paired or not). */
  configured: boolean
  /** It is paired and online right now (last known state). */
  connected: boolean
}

/**
 * The unofficial path's connection, or null when the CRM is not on it
 * (the official-API check applies then).
 */
export function unofficialConnection(info: WhatsAppPathInfo | null | undefined): ConnectionSummary | null {
  if (!info || info.effectivePath !== 'nao_oficial') return null
  // Evolution keeps no cached state here; a ready instance counts as up.
  if (info.provider === 'evolution') return { configured: true, connected: true }
  const n = info.naoOficial ?? {}
  return {
    configured: Boolean(n.configured),
    connected: n.status === 'connected',
  }
}

/** GET /api/whatsapp/path, or null when it can't be read. */
export async function fetchWhatsAppPathInfo(): Promise<WhatsAppPathInfo | null> {
  try {
    const res = await fetch('/api/whatsapp/path', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as WhatsAppPathInfo
  } catch {
    return null
  }
}
