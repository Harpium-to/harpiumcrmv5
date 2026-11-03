// ============================================================
// Lead payload normalization — pure, unit-tested, no I/O.
//
// The single ingest endpoint accepts three shapes and flattens them to
// one `NormalizedLead`:
//
//   - Google Lead Form   → has `user_column_data: [{column_id, string_value}]`
//   - Meta Lead Ads      → has `field_data: [{name, values:[…]}]`
//   - Generic JSON       → flat keys (name/email/phone/…), incl. pt-BR
//                          aliases, so a Zapier/Make forwarder (the usual
//                          way to bridge Meta without app review) or any
//                          form tool can post to the same URL.
// ============================================================

export type LeadSource = 'meta' | 'google' | 'other'

export interface NormalizedLead {
  source: LeadSource
  fullName: string | null
  email: string | null
  phone: string | null
  company: string | null
  campaign: string | null
  formName: string | null
  externalId: string | null
}

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/** First non-null value among `keys` (case-insensitive) on a flat object. */
function pick(obj: Dict, keys: string[]): string | null {
  const lower = new Map<string, unknown>()
  for (const [k, v] of Object.entries(obj)) lower.set(k.toLowerCase(), v)
  for (const k of keys) {
    const hit = str(lower.get(k.toLowerCase()))
    if (hit) return hit
  }
  return null
}

function joinName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

/**
 * Normalize any supported lead payload. Never throws — unknown shapes
 * yield a mostly-empty lead (source 'other') so the raw payload is still
 * stored rather than dropped.
 */
export function normalizeLead(payload: unknown): NormalizedLead {
  if (!isDict(payload)) {
    return blank('other')
  }

  if (Array.isArray(payload.user_column_data)) {
    return normalizeGoogle(payload)
  }
  if (Array.isArray(payload.field_data)) {
    return normalizeMeta(payload)
  }
  return normalizeGeneric(payload)
}

function blank(source: LeadSource): NormalizedLead {
  return {
    source,
    fullName: null,
    email: null,
    phone: null,
    company: null,
    campaign: null,
    formName: null,
    externalId: null,
  }
}

function normalizeGoogle(p: Dict): NormalizedLead {
  const byId = new Map<string, string>()
  for (const col of p.user_column_data as unknown[]) {
    if (!isDict(col)) continue
    const id = str(col.column_id)
    const val = str(col.string_value)
    if (id && val) byId.set(id.toUpperCase(), val)
  }
  const get = (...ids: string[]) => {
    for (const id of ids) {
      const v = byId.get(id.toUpperCase())
      if (v) return v
    }
    return null
  }

  return {
    source: 'google',
    fullName:
      get('FULL_NAME') ?? joinName(get('FIRST_NAME'), get('LAST_NAME')),
    email: get('EMAIL', 'USER_EMAIL', 'WORK_EMAIL'),
    phone: get('PHONE_NUMBER', 'USER_PHONE', 'WORK_PHONE'),
    company: get('COMPANY_NAME'),
    campaign: str(p.campaign_id),
    formName: str(p.form_id),
    externalId: str(p.lead_id),
  }
}

function normalizeMeta(p: Dict): NormalizedLead {
  const byName = new Map<string, string>()
  for (const field of p.field_data as unknown[]) {
    if (!isDict(field)) continue
    const name = str(field.name)
    const values = Array.isArray(field.values) ? field.values : []
    const val = str(values[0])
    if (name && val) byName.set(name.toLowerCase(), val)
  }
  const get = (...names: string[]) => {
    for (const n of names) {
      const v = byName.get(n.toLowerCase())
      if (v) return v
    }
    return null
  }

  return {
    source: 'meta',
    fullName: get('full_name') ?? joinName(get('first_name'), get('last_name')),
    email: get('email'),
    phone: get('phone_number', 'phone'),
    company: get('company_name', 'company'),
    campaign: str(p.campaign_name) ?? str(p.ad_id),
    formName: str(p.form_name) ?? str(p.form_id),
    externalId: str(p.id) ?? str(p.leadgen_id),
  }
}

function normalizeGeneric(p: Dict): NormalizedLead {
  const declared = str(p.source)?.toLowerCase()
  const source: LeadSource =
    declared === 'meta' || declared === 'google' ? declared : 'other'

  return {
    source,
    fullName:
      pick(p, ['full_name', 'fullname', 'name', 'nome']) ??
      joinName(
        pick(p, ['first_name', 'firstname', 'primeiro_nome']),
        pick(p, ['last_name', 'lastname', 'sobrenome']),
      ),
    email: pick(p, ['email', 'e-mail', 'email_address']),
    phone: pick(p, [
      'phone',
      'phone_number',
      'telefone',
      'celular',
      'whatsapp',
      'tel',
    ]),
    company: pick(p, ['company', 'company_name', 'empresa']),
    campaign: pick(p, ['campaign', 'campaign_name', 'campanha']),
    formName: pick(p, ['form', 'form_name', 'formulario', 'formulário']),
    externalId: pick(p, ['external_id', 'lead_id', 'id']),
  }
}
