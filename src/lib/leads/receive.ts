import { NextResponse } from 'next/server'

import { checkRateLimit } from '@/lib/rate-limit'
import { supabaseAdmin } from './admin-client'
import { MAX_LEAD_BODY_BYTES, formPairsToPayload, parseLeadBody, type BodyError } from './body'
import { ingestLead, lacksContactKey, type IngestResult } from './ingest'
import { loadFieldMappings } from './mappings'
import { normalizeLead, type NormalizedLead } from './parse'

// ============================================================
// The public lead-ingest webhook, shared by
//   POST /api/leads/ingest/<token>           (token in the URL)
//   POST /api/leads/ingest  + Authorization: Bearer <token>
//
// Every answer says clearly what happened, so the sender knows whether
// it worked and when to try again:
//   200 lead written (or a repeat already received: "duplicado": true)
//   422 no phone and no e-mail — the lead is kept, but has no contact
//   400 unreadable body · 413 body over 100 KB
//   401 wrong or revoked token · 429 too many deliveries
// ============================================================

/** Deliveries allowed per token per minute. */
const PER_TOKEN_PER_MINUTE = 60

type ErrorCode =
  | BodyError
  | 'token_invalido'
  | 'chave_google_invalida'
  | 'limite'
  | 'erro_interno'

const STATUS: Record<ErrorCode, number> = {
  formato_invalido: 400,
  muito_grande: 413,
  token_invalido: 401,
  chave_google_invalida: 401,
  limite: 429,
  erro_interno: 500,
}

function fail(code: ErrorCode, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, erro: code }, { status: STATUS[code], headers })
}

/** The token from the URL, or from `Authorization: Bearer`. */
function readToken(request: Request, pathToken: string | null): string | null {
  if (pathToken && pathToken.trim()) return pathToken.trim()
  const auth = request.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return m ? m[1].trim() : null
}

async function readPayload(
  request: Request,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: BodyError }> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_LEAD_BODY_BYTES) {
    return { ok: false, error: 'muito_grande' }
  }
  const contentType = request.headers.get('content-type')
  if ((contentType ?? '').toLowerCase().includes('multipart/form-data')) {
    try {
      const form = await request.formData()
      const pairs: [string, string][] = []
      for (const [k, v] of form.entries()) {
        // A file upload is not lead data; keep its name so it isn't lost silently.
        pairs.push([k, typeof v === 'string' ? v : `[arquivo] ${v.name}`])
      }
      const payload = formPairsToPayload(pairs)
      return Object.keys(payload).length
        ? { ok: true, payload }
        : { ok: false, error: 'formato_invalido' }
    } catch {
      return { ok: false, error: 'formato_invalido' }
    }
  }
  let body: string
  try {
    body = await request.text()
  } catch {
    return { ok: false, error: 'formato_invalido' }
  }
  return parseLeadBody(contentType, body)
}

interface ResolvedToken {
  accountId: string
  googleKey: string | null
}

async function resolveToken(token: string): Promise<ResolvedToken | null | 'error'> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('lead_ingest')
    .select('account_id, google_key')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    console.error('[leads ingest] config lookup failed:', error.message)
    return 'error'
  }
  if (!data) return null
  return { accountId: data.account_id, googleKey: data.google_key ?? null }
}

export function successBody(result: IngestResult) {
  return {
    ok: true,
    contato_id: result.contactId,
    lead_id: result.leadId,
    contato: result.contactStatus,
    ...(result.duplicate ? { duplicado: true } : {}),
    // Kept for integrations built before the Harpium Lead v1 answers.
    contact_id: result.contactId,
  }
}

export async function handleLeadIngest(
  request: Request,
  pathToken: string | null,
): Promise<NextResponse> {
  const token = readToken(request, pathToken)
  if (!token) return fail('token_invalido')

  const limit = checkRateLimit(`lead-ingest:${token}`, {
    limit: PER_TOKEN_PER_MINUTE,
    windowMs: 60_000,
  })
  if (!limit.success) {
    const retry = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))
    return fail('limite', { 'Retry-After': String(retry) })
  }

  const body = await readPayload(request)
  if (!body.ok) return fail(body.error)
  const payload = body.payload

  const cfg = await resolveToken(token)
  if (cfg === 'error') return fail('erro_interno')
  if (!cfg) return fail('token_invalido')

  // Google Lead Form deliveries carry a `google_key`; if the account set
  // one, it must match. (Other sources authenticate by the token.)
  if (Array.isArray(payload.user_column_data) && cfg.googleKey) {
    const provided = typeof payload.google_key === 'string' ? payload.google_key : ''
    if (provided !== cfg.googleKey) return fail('chave_google_invalida')
  }

  const admin = supabaseAdmin()
  const { data: acc, error: accErr } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', cfg.accountId)
    .maybeSingle()
  if (accErr || !acc) {
    console.error('[leads ingest] account lookup failed:', accErr?.message)
    return fail('erro_interno')
  }

  const lead: NormalizedLead = normalizeLead(payload)
  // Secrets are checked above and never stored with the lead.
  const raw = { ...payload }
  delete raw.google_key

  let result: IngestResult
  try {
    const mappings = await loadFieldMappings(admin, cfg.accountId, lead.source)
    result = await ingestLead(
      admin,
      { id: cfg.accountId, ownerUserId: acc.owner_user_id },
      lead,
      raw,
      { mappings },
    )
  } catch (err) {
    console.error('[leads ingest] failed:', err)
    return fail('erro_interno')
  }

  // Kept (raw payload in "Leads recebidos"), but without a phone or an
  // e-mail no contact can be created — say so, so the sender can fix it.
  if (lacksContactKey(lead) && !result.contactId) {
    return NextResponse.json(
      { ok: false, erro: 'telefone_ou_email_obrigatorio', lead_id: result.leadId },
      { status: 422 },
    )
  }

  return NextResponse.json(successBody(result))
}
