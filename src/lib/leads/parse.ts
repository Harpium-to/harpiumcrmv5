// ============================================================
// Lead payload normalization — pure, unit-tested, no I/O.
//
// The single ingest endpoint accepts four shapes and translates them to
// one `NormalizedLead` (the in-memory form of "Harpium Lead v1"):
//
//   - Harpium Lead v1  → has `versao: "1"`; already in our format
//                        (the quiz and any integration built for us)
//   - Google Lead Form → has `user_column_data: [{column_id, string_value}]`
//   - Meta Lead Ads    → has `field_data: [{name, values:[…]}]`
//   - Generic JSON     → flat keys (name/email/phone/…), incl. pt-BR
//                        aliases, so Zapier/Make or any form tool can post
//                        to the same URL.
//
// The rule that drives every adapter: nothing received is dropped. What
// has a contact column goes there; everything else lands in `answers`,
// `fields` or `campaignDetails`, which the ingest writes to the contact
// (tags, custom fields, a note). The raw payload is kept as well.
// ============================================================

/** Where the lead came from, as stored in `leads.source`. */
export type LeadSource = string

export type LeadFormat = 'harpium-v1' | 'google' | 'meta' | 'generic'

export type LeadRoute = 'A' | 'B' | 'C'

export interface LeadAnswer {
  pergunta: string
  resposta: string
}

export interface LeadConsent {
  accepted: boolean | null
  text: string | null
  at: string | null
}

export interface NormalizedLead {
  /** `leads.source`: 'meta' | 'google' | 'other' | the declared origin slug. */
  source: LeadSource
  format: LeadFormat
  /** The origin as the sender named it (e.g. "quiz-planejados"). */
  origin: string | null
  fullName: string | null
  email: string | null
  /** Normalized: "+" and digits, Brazilian mobiles with the ninth digit. */
  phone: string | null
  company: string | null
  campaign: string | null
  formName: string | null
  externalId: string | null
  city: string | null
  instagram: string | null
  /** UTMs, click ids, ad set / ad names — kept for the lead history. */
  campaignDetails: Record<string, string>
  tags: string[]
  route: LeadRoute | null
  qualified: boolean | null
  score: number | null
  reasons: string[]
  /** Questions and answers (quiz, extra form columns). */
  answers: LeadAnswer[]
  /** Key → value pairs; matched to custom fields, the rest goes to the note. */
  fields: Record<string, string>
  note: string | null
  consent: LeadConsent | null
}

type Dict = Record<string, unknown>

// Caps keep a hostile or buggy sender from turning one POST into
// thousands of tags or a megabyte note. Generous for any real form.
const MAX_TAGS = 30
const MAX_TAG_LENGTH = 60
const MAX_ANSWERS = 100
const MAX_FIELDS = 100
const MAX_TEXT = 2000

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clip(s: string, max = MAX_TEXT): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? clip(t) : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  return null
}

/** Any value as display text: arrays joined, objects as JSON. */
function text(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.map(text).filter((x): x is string => Boolean(x))
    return parts.length ? clip(parts.join(', ')) : null
  }
  if (isDict(v)) {
    const json = JSON.stringify(v)
    return json === '{}' ? null : clip(json)
  }
  return str(v)
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const t = fold(v)
    if (['sim', 's', 'true', 'yes', 'y', '1', 'aceito', 'qualificado'].includes(t)) return true
    if (['nao', 'n', 'false', 'no', '0', 'recusado'].includes(t)) return false
  }
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Lowercase, accents removed, trimmed — for comparing names and keys. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** A key folded so "Ticket médio", "ticket_medio" and "ticket-medio" agree. */
export function foldKey(value: string): string {
  return fold(value).replace(/[\s_\-.]+/g, '_').replace(/^_+|_+$/g, '')
}

/** "quiz planejados" / "Quiz_Planejados" → "quiz-planejados". */
export function slugify(value: string): string {
  return fold(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** "qual_o_seu_faturamento" → "Qual o seu faturamento". */
function humanize(key: string): string {
  const spaced = key.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!spaced) return key
  const lower = spaced === spaced.toUpperCase() ? spaced.toLowerCase() : spaced
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** First non-null value among `keys` (case-insensitive) on a flat object. */
function pick(obj: Dict, keys: string[], used?: Set<string>): string | null {
  const lower = new Map<string, [string, unknown]>()
  for (const [k, v] of Object.entries(obj)) lower.set(k.toLowerCase(), [k, v])
  for (const k of keys) {
    const entry = lower.get(k.toLowerCase())
    if (!entry) continue
    const hit = str(entry[1])
    if (hit) {
      used?.add(entry[0])
      return hit
    }
  }
  return null
}

function joinName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

/**
 * The phone as the CRM keys it: "+" then digits, with Brazil's country
 * code and mobile ninth digit filled in when the sender left them out.
 * Numbers that are too short to be a phone come back null.
 *
 *   "(63) 99999-0000"  → "+5563999990000"
 *   "63 9999-0000"     → "+5563999990000"   (8-digit mobile, 9 added)
 *   "+55 63 9999-0000" → "+5563999990000"
 *   "+1 415 555 0100"  → "+14155550100"     (other countries untouched)
 */
export function normalizeLeadPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const hadPlus = raw.trim().startsWith('+')
  let digits = raw.replace(/\D/g, '')
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2)
  else if (!hadPlus) digits = digits.replace(/^0+/, '')
  if (digits.length < 8 || digits.length > 15) return null

  // Domestic Brazilian number (DDD + 8 or 9 digits), no country code.
  if (!hadPlus && (digits.length === 10 || digits.length === 11) && /^[1-9]{2}/.test(digits)) {
    digits = `55${digits}`
  }
  // Brazilian mobile written without the ninth digit.
  const old = /^55([1-9]{2})([6-9]\d{7})$/.exec(digits)
  if (old) digits = `55${old[1]}9${old[2]}`

  return `+${digits}`
}

function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

function normalizeInstagram(raw: string | null): string | null {
  if (!raw) return null
  const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(raw)
  const handle = (m ? m[1] : raw).trim().replace(/^@+/, '')
  return handle ? `@${handle}` : null
}

function normalizeRoute(v: unknown): LeadRoute | null {
  const s = str(v)
  if (!s) return null
  const m = /^(?:rota[\s_-]*)?([abc])$/i.exec(s.trim())
  return m ? (m[1].toUpperCase() as LeadRoute) : null
}

/** A list from an array or a comma/semicolon/line separated string. */
function normalizeList(v: unknown, maxItems: number, maxLength: number): string[] {
  const raw: unknown[] = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[,;\n]/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const s = str(item)
    if (!s) continue
    const value = s.slice(0, maxLength).trim()
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= maxItems) break
  }
  return out
}

function normalizeTags(v: unknown): string[] {
  return normalizeList(v, MAX_TAGS, MAX_TAG_LENGTH)
}

function normalizeAnswers(v: unknown): LeadAnswer[] {
  const out: LeadAnswer[] = []
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!isDict(item)) continue
      const pergunta = str(item.pergunta ?? item.question ?? item.label ?? item.campo)
      const resposta = text(item.resposta ?? item.answer ?? item.value ?? item.valor)
      if (pergunta && resposta) out.push({ pergunta, resposta })
      if (out.length >= MAX_ANSWERS) break
    }
  } else if (isDict(v)) {
    for (const [k, val] of Object.entries(v)) {
      const resposta = text(val)
      if (resposta) out.push({ pergunta: clip(k, 300), resposta })
      if (out.length >= MAX_ANSWERS) break
    }
  }
  return out
}

function normalizeFields(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isDict(v)) return out
  let n = 0
  for (const [k, val] of Object.entries(v)) {
    const key = k.trim()
    const value = text(val)
    if (!key || !value) continue
    out[clip(key, 100)] = value
    if (++n >= MAX_FIELDS) break
  }
  return out
}

function normalizeConsent(v: unknown): LeadConsent | null {
  if (isDict(v)) {
    const consent = {
      accepted: bool(v.aceito ?? v.accepted ?? v.consent),
      text: str(v.texto ?? v.text),
      at: str(v.em ?? v.at ?? v.data),
    }
    return consent.accepted === null && !consent.text && !consent.at ? null : consent
  }
  const accepted = bool(v)
  return accepted === null ? null : { accepted, text: null, at: null }
}

const CAMPAIGN_KEYS: [string, string][] = [
  ['nome', 'nome'],
  ['name', 'nome'],
  ['conjunto', 'conjunto'],
  ['adset', 'conjunto'],
  ['adset_name', 'conjunto'],
  ['anuncio', 'anuncio'],
  ['anúncio', 'anuncio'],
  ['ad', 'anuncio'],
  ['ad_name', 'anuncio'],
  ['utm_source', 'utm_source'],
  ['utm_medium', 'utm_medium'],
  ['utm_campaign', 'utm_campaign'],
  ['utm_content', 'utm_content'],
  ['utm_term', 'utm_term'],
  ['fbclid', 'fbclid'],
  ['gclid', 'gclid'],
]

function blank(source: LeadSource, format: LeadFormat): NormalizedLead {
  return {
    source,
    format,
    origin: null,
    fullName: null,
    email: null,
    phone: null,
    company: null,
    campaign: null,
    formName: null,
    externalId: null,
    city: null,
    instagram: null,
    campaignDetails: {},
    tags: [],
    route: null,
    qualified: null,
    score: null,
    reasons: [],
    answers: [],
    fields: {},
    note: null,
    consent: null,
  }
}

/** True when the payload declares itself Harpium Lead v1. */
export function isHarpiumV1(payload: unknown): boolean {
  return isDict(payload) && String(payload.versao ?? '').trim() === '1'
}

/**
 * Normalize any supported lead payload. Never throws — unknown shapes
 * yield a mostly-empty lead (source 'other') so the raw payload is still
 * stored rather than dropped.
 */
export function normalizeLead(payload: unknown): NormalizedLead {
  if (!isDict(payload)) {
    return blank('other', 'generic')
  }
  if (isHarpiumV1(payload)) {
    return normalizeHarpiumV1(payload)
  }
  if (Array.isArray(payload.user_column_data)) {
    return normalizeGoogle(payload)
  }
  if (Array.isArray(payload.field_data)) {
    return normalizeMeta(payload)
  }
  return normalizeGeneric(payload)
}

// ------------------------------------------------------------
// Harpium Lead v1
// ------------------------------------------------------------

function normalizeHarpiumV1(p: Dict): NormalizedLead {
  const lead = blank('other', 'harpium-v1')
  const contato = isDict(p.contato) ? p.contato : {}
  // Lenient: a sender that put the contact keys at the top level still works.
  const c: Dict = { ...p, ...contato }

  const origin = str(p.origem)
  lead.origin = origin
  lead.source = origin ? slugify(origin) || 'other' : 'other'
  lead.externalId = str(p.id_externo)

  lead.fullName = pick(c, ['nome', 'name', 'full_name'])
  lead.phone = normalizeLeadPhone(pick(c, ['telefone', 'phone', 'whatsapp', 'celular']))
  lead.email = normalizeEmail(pick(c, ['email', 'e-mail']))
  lead.company = pick(c, ['empresa', 'company'])
  lead.city = pick(c, ['cidade', 'city'])
  lead.instagram = normalizeInstagram(pick(c, ['instagram']))

  const fields = normalizeFields(p.campos)
  const uf = pick(c, ['uf', 'estado', 'state'])
  if (uf && !Object.keys(fields).some((k) => foldKey(k) === 'uf')) {
    lead.fields = { uf, ...fields }
  } else {
    lead.fields = fields
  }

  if (isDict(p.campanha)) {
    lead.campaignDetails = readCampaign(p.campanha)
    lead.campaign =
      lead.campaignDetails.nome ?? lead.campaignDetails.utm_campaign ?? null
  } else {
    lead.campaign = str(p.campanha)
  }

  const q = isDict(p.qualificacao) ? p.qualificacao : {}
  lead.route = normalizeRoute(q.rota ?? p.rota)
  lead.qualified = bool(q.qualificado)
  lead.score = num(q.pontuacao)
  lead.reasons = normalizeList(q.motivos, 20, 300)

  lead.tags = normalizeTags(p.etiquetas)
  lead.answers = normalizeAnswers(p.respostas)
  lead.note = str(p.nota)
  lead.consent = normalizeConsent(p.consentimento)
  lead.formName = str(p.formulario)
  return lead
}

function readCampaign(obj: Dict): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const [from, to] of CAMPAIGN_KEYS) {
    if (out[to]) continue
    const v = pick(obj, [from], used)
    if (v) out[to] = v
  }
  // Keep anything else the sender put in the campaign object.
  for (const [k, v] of Object.entries(obj)) {
    if (used.has(k)) continue
    const s = text(v)
    if (s && !out[k]) out[k] = s
  }
  return out
}

// ------------------------------------------------------------
// Google Lead Form
// ------------------------------------------------------------

const GOOGLE_CONSUMED = new Set([
  'FULL_NAME',
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'USER_EMAIL',
  'WORK_EMAIL',
  'PHONE_NUMBER',
  'USER_PHONE',
  'WORK_PHONE',
  'COMPANY_NAME',
  'CITY',
])

function normalizeGoogle(p: Dict): NormalizedLead {
  const lead = blank('google', 'google')
  lead.origin = 'google'
  const byId = new Map<string, string>()
  for (const col of p.user_column_data as unknown[]) {
    if (!isDict(col)) continue
    const id = str(col.column_id)
    const val = str(col.string_value)
    if (!id || !val) continue
    byId.set(id.toUpperCase(), val)
    // Extra columns (custom questions, address, job title…) used to be
    // dropped; now each one becomes an answer in the contact's note.
    if (!GOOGLE_CONSUMED.has(id.toUpperCase()) && lead.answers.length < MAX_ANSWERS) {
      lead.answers.push({ pergunta: str(col.column_name) ?? humanize(id), resposta: val })
    }
  }
  const get = (...ids: string[]) => {
    for (const id of ids) {
      const v = byId.get(id.toUpperCase())
      if (v) return v
    }
    return null
  }

  lead.fullName = get('FULL_NAME') ?? joinName(get('FIRST_NAME'), get('LAST_NAME'))
  lead.email = normalizeEmail(get('EMAIL', 'USER_EMAIL', 'WORK_EMAIL'))
  lead.phone = normalizeLeadPhone(get('PHONE_NUMBER', 'USER_PHONE', 'WORK_PHONE'))
  lead.company = get('COMPANY_NAME')
  lead.city = get('CITY')
  lead.campaign = str(p.campaign_name) ?? str(p.campaign_id)
  lead.formName = str(p.form_name) ?? str(p.form_id)
  lead.externalId = str(p.lead_id)

  const details: Record<string, string> = {}
  const add = (k: string, v: unknown) => {
    const s = str(v)
    if (s) details[k] = s
  }
  add('campaign_id', p.campaign_id)
  add('adgroup_id', p.adgroup_id)
  add('creative_id', p.creative_id)
  add('gclid', p.gcl_id)
  if (p.is_test === true) details.teste = 'sim'
  lead.campaignDetails = details
  return lead
}

// ------------------------------------------------------------
// Meta Lead Ads
// ------------------------------------------------------------

const META_CONSUMED = new Set([
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'phone',
  'company_name',
  'company',
  'city',
])

function normalizeMeta(p: Dict): NormalizedLead {
  const lead = blank('meta', 'meta')
  lead.origin = 'meta'
  const byName = new Map<string, string>()
  for (const field of p.field_data as unknown[]) {
    if (!isDict(field)) continue
    const name = str(field.name)
    const values = Array.isArray(field.values) ? field.values : []
    const val = text(values)
    if (!name || !val) continue
    byName.set(name.toLowerCase(), val)
    // Custom questions of the form used to be dropped.
    if (!META_CONSUMED.has(name.toLowerCase()) && lead.answers.length < MAX_ANSWERS) {
      lead.answers.push({ pergunta: humanize(name), resposta: val })
    }
  }
  const get = (...names: string[]) => {
    for (const n of names) {
      const v = byName.get(n.toLowerCase())
      if (v) return v
    }
    return null
  }

  lead.fullName = get('full_name') ?? joinName(get('first_name'), get('last_name'))
  lead.email = normalizeEmail(get('email'))
  lead.phone = normalizeLeadPhone(get('phone_number', 'phone'))
  lead.company = get('company_name', 'company')
  lead.city = get('city')
  lead.campaign = str(p.campaign_name) ?? str(p.ad_id)
  lead.formName = str(p.form_name) ?? str(p.form_id)
  lead.externalId = str(p.id) ?? str(p.leadgen_id)

  const details: Record<string, string> = {}
  const add = (k: string, v: unknown) => {
    const s = str(v)
    if (s) details[k] = s
  }
  add('nome', p.campaign_name)
  add('conjunto', p.adset_name)
  add('anuncio', p.ad_name)
  add('ad_id', p.ad_id)
  add('plataforma', p.platform)
  if (p.is_organic === true) details.organico = 'sim'
  lead.campaignDetails = details
  return lead
}

// ------------------------------------------------------------
// Generic JSON / form (Zapier, Make, site forms)
// ------------------------------------------------------------

// Keys that must never end up in a note: secrets and transport noise.
const GENERIC_SKIP = new Set(['google_key', 'token', 'api_key', 'apikey', 'secret', 'versao'])

function normalizeGeneric(p: Dict): NormalizedLead {
  const lead = blank('other', 'generic')
  const used = new Set<string>()

  const declared = pick(p, ['origem', 'source', 'fonte'], used)
  const declaredFold = declared ? fold(declared) : null
  if (declaredFold === 'meta' || declaredFold === 'google') {
    lead.source = declaredFold
    lead.origin = declaredFold
  } else if (declared) {
    lead.origin = declared
    lead.source = slugify(declared) || 'other'
  }

  lead.fullName =
    pick(p, ['full_name', 'fullname', 'name', 'nome', 'nome_completo', 'nome completo'], used) ??
    joinName(
      pick(p, ['first_name', 'firstname', 'primeiro_nome'], used),
      pick(p, ['last_name', 'lastname', 'sobrenome'], used),
    )
  lead.email = normalizeEmail(pick(p, ['email', 'e-mail', 'email_address', 'e_mail'], used))
  lead.phone = normalizeLeadPhone(
    pick(
      p,
      ['phone', 'phone_number', 'telefone', 'celular', 'whatsapp', 'tel', 'fone', 'mobile'],
      used,
    ),
  )
  lead.company = pick(p, ['company', 'company_name', 'empresa', 'nome_empresa'], used)
  lead.campaign = pick(p, ['campaign', 'campaign_name', 'campanha'], used)
  lead.formName = pick(p, ['form', 'form_name', 'formulario', 'formulário'], used)
  lead.externalId = pick(p, ['external_id', 'id_externo', 'lead_id', 'id'], used)
  lead.city = pick(p, ['city', 'cidade'], used)
  lead.instagram = normalizeInstagram(pick(p, ['instagram', 'insta'], used))
  lead.route = normalizeRoute(pick(p, ['rota', 'route'], used))
  lead.note = pick(p, ['nota', 'observacao', 'observação', 'mensagem', 'message', 'obs'], used)

  // Campaign details from flat keys (utm_*, click ids, ad set / ad names).
  const details: Record<string, string> = {}
  for (const [from, to] of CAMPAIGN_KEYS) {
    if (from === 'nome' || from === 'name' || details[to]) continue
    const v = pick(p, [from], used)
    if (v) details[to] = v
  }
  if (isDict(p.campanha)) {
    used.add('campanha')
    Object.assign(details, readCampaign(p.campanha))
    lead.campaign = lead.campaign ?? details.nome ?? details.utm_campaign ?? null
  }
  lead.campaignDetails = details

  for (const key of ['etiquetas', 'tags', 'etiqueta', 'tag']) {
    const hit = Object.keys(p).find((k) => k.toLowerCase() === key)
    if (hit) {
      used.add(hit)
      lead.tags = normalizeTags(p[hit])
      break
    }
  }
  for (const key of ['respostas', 'answers']) {
    if (key in p) {
      used.add(key)
      lead.answers = normalizeAnswers(p[key])
    }
  }
  if ('consentimento' in p) {
    used.add('consentimento')
    lead.consent = normalizeConsent(p.consentimento)
  }
  if (isDict(p.campos)) {
    used.add('campos')
    lead.fields = normalizeFields(p.campos)
  }

  // Everything else becomes a field: matched to a custom field with the
  // same name, or written to the note. Nested objects are flattened one
  // level ("endereco.rua") so a Zapier object doesn't arrive as JSON soup.
  let n = Object.keys(lead.fields).length
  for (const [k, v] of Object.entries(p)) {
    if (used.has(k) || GENERIC_SKIP.has(k.toLowerCase())) continue
    if (n >= MAX_FIELDS) break
    if (isDict(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        const s = text(v2)
        if (s && n < MAX_FIELDS) {
          lead.fields[`${k}.${k2}`] = s
          n++
        }
      }
      continue
    }
    const s = text(v)
    if (s) {
      lead.fields[k] = s
      n++
    }
  }
  return lead
}

/** The tag that marks a route, so flows can filter on it ("rota-a"). */
export function routeTag(route: LeadRoute | null): string | null {
  return route ? `rota-${route.toLowerCase()}` : null
}

/** Every tag the lead puts on its contact, route tag included. */
export function leadTags(lead: NormalizedLead): string[] {
  const rt = routeTag(lead.route)
  const all = rt ? [...lead.tags, rt] : [...lead.tags]
  return normalizeTags(all)
}
