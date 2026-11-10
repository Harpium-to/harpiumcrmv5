// ============================================================
// Quick replies with a file: a photo, a video, a document or an audio
// sent as a voice note (Fase 4B, step 3; migration 063).
//
// The file lives in the `chat-media` bucket, like an attachment from
// the inbox, under the account's own folder. A quick reply is sent
// from the customer's number by the inbox, the Chrome extension and
// the public API, so the CRM only keeps a file this account uploaded:
// the path must sit in `account-<id>/`, and the URL must be that
// path's public URL in this CRM's storage. Anything else — a link to
// someone else's site, another account's folder — is refused.
// ============================================================

export const QUICK_REPLY_MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export type QuickReplyMediaKind = (typeof QUICK_REPLY_MEDIA_KINDS)[number];

/** What a person calls each kind. */
export const QUICK_REPLY_MEDIA_LABELS: Record<QuickReplyMediaKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Arquivo',
  audio: 'Áudio',
};

export const QUICK_REPLY_MEDIA_BUCKET = 'chat-media';

/** WhatsApp's caption limit; audio takes none. */
export const QUICK_REPLY_CAPTION_MAX = 1024;
const FILENAME_MAX = 200;

// The chat-media bucket's allowed types (migration 023), by kind.
const MIME_KINDS: Record<string, QuickReplyMediaKind> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/3gpp': 'video',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'text/plain': 'document',
  'audio/ogg': 'audio',
  'audio/mpeg': 'audio',
  'audio/aac': 'audio',
  'audio/mp4': 'audio',
  'audio/amr': 'audio',
};

/** Every type a quick reply file may be, for a file picker's `accept`. */
export const QUICK_REPLY_MEDIA_ACCEPT = Object.keys(MIME_KINDS).join(',');

/** The kind of a file the bucket accepts, by its MIME type; null when it doesn't. */
export function mediaKindForMime(mime: string | null | undefined): QuickReplyMediaKind | null {
  if (typeof mime !== 'string') return null;
  return MIME_KINDS[mime.split(';')[0].trim().toLowerCase()] ?? null;
}

export function isQuickReplyMediaKind(value: unknown): value is QuickReplyMediaKind {
  return (
    typeof value === 'string' &&
    (QUICK_REPLY_MEDIA_KINDS as readonly string[]).includes(value)
  );
}

export interface QuickReplyMedia {
  media_kind: QuickReplyMediaKind;
  media_url: string;
  media_path: string;
  media_filename: string | null;
  /** Stored in `content_text`; always null for audio. */
  content_text: string | null;
}

export type ParsedQuickReplyMedia =
  | { ok: true; value: QuickReplyMedia }
  | { ok: false; error: string };

/**
 * Check the file part of a quick reply against the account that saves
 * it. `storageUrl` is this CRM's Supabase URL (no trailing slash).
 */
export function parseQuickReplyMedia(
  body: unknown,
  accountId: string,
  storageUrl: string,
): ParsedQuickReplyMedia {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (!isQuickReplyMediaKind(b.media_kind)) {
    return { ok: false, error: 'Escolha o arquivo da resposta rápida.' };
  }
  const path = typeof b.media_path === 'string' ? b.media_path : '';
  const url = typeof b.media_url === 'string' ? b.media_url : '';
  const folder = `account-${accountId}/`;
  const ownPath =
    path.startsWith(folder) && /^[A-Za-z0-9._-]+$/.test(path.slice(folder.length));
  const base = storageUrl.replace(/\/+$/, '');
  const ownUrl =
    base !== '' && url === `${base}/storage/v1/object/public/${QUICK_REPLY_MEDIA_BUCKET}/${path}`;
  if (!ownPath || !ownUrl) {
    return { ok: false, error: 'O arquivo precisa ser enviado por esta tela, nesta conta.' };
  }

  const rawName = typeof b.media_filename === 'string' ? b.media_filename.trim() : '';
  const media_filename = rawName ? rawName.slice(0, FILENAME_MAX) : null;

  let content_text: string | null = null;
  if (b.media_kind !== 'audio' && typeof b.content_text === 'string' && b.content_text.trim()) {
    if (b.content_text.length > QUICK_REPLY_CAPTION_MAX) {
      return {
        ok: false,
        error: `A legenda passa de ${QUICK_REPLY_CAPTION_MAX} caracteres, o limite do WhatsApp.`,
      };
    }
    content_text = b.content_text;
  }

  return {
    ok: true,
    value: { media_kind: b.media_kind, media_url: url, media_path: path, media_filename, content_text },
  };
}

/** The columns that say "no file", for a reply that stops having one. */
export const NO_QUICK_REPLY_MEDIA = {
  media_kind: null,
  media_url: null,
  media_path: null,
  media_filename: null,
} as const;
