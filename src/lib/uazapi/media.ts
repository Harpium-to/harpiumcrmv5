import type { SupabaseClient } from '@supabase/supabase-js'

import { downloadUazapiMedia, type UazapiServer } from './api'

// ============================================================
// Received media, copied into our own storage (D1).
//
// UAZAPI hands out a public link to the file, but keeps it for 2 days
// only. A conversation is read for much longer than that, so the file
// is copied into the `chat-media` bucket (public, 16 MB, migration
// 023) under the account's folder — the same place the composer puts
// what the team sends — and the message keeps our URL.
//
// Best-effort: any failure returns null and the message is stored as
// text saying a file arrived, instead of being lost.
// ============================================================

const BUCKET = 'chat-media'
const MAX_BYTES = 16 * 1024 * 1024

/** The extensions the bucket's allowlist accepts, by MIME type. */
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
}

/** "audio/ogg; codecs=opus" → "audio/ogg". Pure. */
export function baseMime(mime: string | null | undefined): string | null {
  const m = mime?.split(';')[0]?.trim().toLowerCase()
  return m ? m : null
}

/** Object path inside the bucket. The first segment is what its RLS matches on. Pure. */
export function mediaObjectPath(
  accountId: string,
  externalId: string,
  ext: string,
  now: number = Date.now(),
): string {
  const safeId = externalId.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'midia'
  return `account-${accountId}/${now}-wa_${safeId}.${ext}`
}

export async function copyUazapiMediaToStorage(
  admin: SupabaseClient,
  accountId: string,
  srv: UazapiServer,
  externalId: string,
): Promise<string | null> {
  try {
    const link = await downloadUazapiMedia(srv, externalId)
    if (!link) return null

    const res = await fetch(link.fileUrl)
    if (!res.ok) {
      console.error('[uazapi media] download failed:', res.status)
      return null
    }
    const mime = baseMime(link.mimetype) ?? baseMime(res.headers.get('content-type'))
    const ext = mime ? EXT[mime] : undefined
    if (!mime || !ext) {
      console.warn('[uazapi media] type not kept:', mime)
      return null
    }
    const body = await res.arrayBuffer()
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
      console.warn('[uazapi media] size not kept:', body.byteLength)
      return null
    }

    const path = mediaObjectPath(accountId, externalId, ext)
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, body, { contentType: mime, upsert: false })
    if (error) {
      console.error('[uazapi media] upload failed:', error.message)
      return null
    }
    return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.error('[uazapi media] copy failed:', err instanceof Error ? err.message : err)
    return null
  }
}
