// ============================================================
// Instagram Messaging, over the Meta Graph API.
//
// Sending is `POST /{ig-user-id}/messages` with the Page token the
// Instagram account is linked to. Two things about this API shape the
// error handling here:
//
//   * The 24-hour window. Outside 24h from the person's last message
//     Meta refuses the send, and it is a policy refusal rather than a
//     bug. The operator needs to read that, so the API's own message
//     is passed through instead of being flattened to "falhou".
//   * Tokens expire and get revoked. Same reasoning — "token inválido"
//     and "fora da janela de 24h" need completely different actions,
//     and a generic failure string sends someone to the wrong one.
// ============================================================

const GRAPH_VERSION = 'v21.0'

export interface InstagramCreds {
  igUserId: string
  accessToken: string
}

export class InstagramApiError extends Error {
  readonly code: number | null
  readonly subcode: number | null
  constructor(message: string, code: number | null, subcode: number | null) {
    super(message)
    this.name = 'InstagramApiError'
    this.code = code
    this.subcode = subcode
  }
}

async function readError(res: Response): Promise<InstagramApiError> {
  let message = `HTTP ${res.status}`
  let code: number | null = null
  let subcode: number | null = null
  try {
    const body = await res.json()
    const err = body?.error
    if (err) {
      message = err.error_user_msg || err.message || message
      code = typeof err.code === 'number' ? err.code : null
      subcode = typeof err.error_subcode === 'number' ? err.error_subcode : null
    }
  } catch {
    /* keep the status */
  }
  return new InstagramApiError(message, code, subcode)
}

/** Send a text DM to one person, by their IGSID. */
export async function sendInstagramText(
  creds: InstagramCreds,
  recipientId: string,
  text: string,
): Promise<{ externalId: string | null }> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
      creds.igUserId,
    )}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    },
  )
  if (!res.ok) throw await readError(res)
  const body = await res.json().catch(() => ({}))
  return {
    externalId: typeof body?.message_id === 'string' ? body.message_id : null,
  }
}

/**
 * Confirm the credentials before saving them.
 *
 * Checked against the Instagram account itself rather than a generic
 * `/me`: a Page token that cannot read this particular Instagram
 * account will pass a `/me` probe and then fail on the first real
 * message, which is the worst moment to find out.
 */
export async function checkInstagramCreds(
  creds: InstagramCreds,
): Promise<{ ok: boolean; username?: string; detail?: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
        creds.igUserId,
      )}?fields=username,name`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } },
    )
    if (!res.ok) {
      const err = await readError(res)
      return { ok: false, detail: err.message }
    }
    const body = await res.json().catch(() => ({}))
    return {
      ok: true,
      username: typeof body?.username === 'string' ? body.username : undefined,
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'erro de rede',
    }
  }
}
