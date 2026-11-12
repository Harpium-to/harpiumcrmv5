import type { SupabaseClient } from '@supabase/supabase-js'

import { foldKey } from '@/lib/leads/parse'

// ============================================================
// What the CRM knows about one contact, in one place.
//
// Read by the AI (the agent answering, the agent opening a
// conversation, "Sugerir resposta") so it talks to the customer with
// the whole context — name, company, what the lead answered — and by
// automations, whose messages may use {{ contato.* }} and
// {{ campo.* }} (lib/automations/variables.ts).
//
// Every query is scoped to the account: callers use the service role.
// ============================================================

export interface ContactProfileField {
  name: string
  /** `{{ campo.<key> }}`: the name folded to letters, digits and "_". */
  key: string
  /** The key a lead created the field under, when it differs (070). */
  leadKey: string | null
  value: string
}

export interface ContactProfile {
  /** Null when the stored name is only the phone number. */
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
  city: string | null
  instagram: string | null
  jobTitle: string | null
  segment: string | null
  website: string | null
  source: string | null
  tags: string[]
  fields: ContactProfileField[]
  /** Open deals: the card title and its stage. */
  deals: { title: string; stage: string | null }[]
}

/** The key a field is written with in `{{ campo.<key> }}`. */
export function variableKey(name: string): string {
  return foldKey(name)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/** A name that is only the phone ("5563999990000") is no name. */
export function usableName(name: unknown): string | null {
  const t = text(name)
  if (!t) return null
  return /^[\d\s+().-]*$/.test(t) ? null : t
}

export async function loadContactProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ContactProfile | null> {
  const { data: contact, error } = await db
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !contact) return null
  const c = contact as Record<string, unknown>

  const [fields, tags, deals] = await Promise.all([
    loadFields(db, accountId, contactId).catch(() => []),
    loadTags(db, accountId, contactId).catch(() => []),
    loadDeals(db, accountId, contactId).catch(() => []),
  ])

  return {
    name: usableName(c.name),
    phone: text(c.phone),
    email: text(c.email),
    company: text(c.company),
    city: text(c.city),
    instagram: text(c.instagram),
    jobTitle: text(c.job_title),
    segment: text(c.segment),
    website: text(c.website),
    source: text(c.source),
    tags,
    fields,
    deals,
  }
}

async function loadFields(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ContactProfileField[]> {
  const { data: values, error } = await db
    .from('contact_custom_values')
    .select('custom_field_id, value')
    .eq('contact_id', contactId)
  if (error) throw error
  const filled = new Map<string, string>()
  for (const v of (values ?? []) as { custom_field_id: string; value: string | null }[]) {
    const t = text(v.value)
    if (t) filled.set(v.custom_field_id, t)
  }
  if (filled.size === 0) return []

  const { data: defs, error: defErr } = await db
    .from('custom_fields')
    .select('*')
    .eq('account_id', accountId)
    .in('id', Array.from(filled.keys()))
    .order('created_at', { ascending: true })
  if (defErr) throw defErr
  return ((defs ?? []) as { id: string; field_name: string; field_key?: string | null }[]).map((f) => {
    const key = variableKey(f.field_name)
    const leadKey = f.field_key ? variableKey(f.field_key) : null
    return {
      name: f.field_name,
      key,
      leadKey: leadKey && leadKey !== key ? leadKey : null,
      value: filled.get(f.id) ?? '',
    }
  })
}

async function loadTags(db: SupabaseClient, accountId: string, contactId: string): Promise<string[]> {
  const { data: links, error } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId)
  if (error) throw error
  const ids = ((links ?? []) as { tag_id: string }[]).map((l) => l.tag_id)
  if (ids.length === 0) return []
  const { data: tags, error: tagErr } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId)
    .in('id', ids)
  if (tagErr) throw tagErr
  return ((tags ?? []) as { name: string }[]).map((t) => t.name).filter(Boolean).sort()
}

async function loadDeals(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<{ title: string; stage: string | null }[]> {
  const { data: deals, error } = await db
    .from('deals')
    .select('title, stage_id, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .limit(3)
  if (error) throw error
  const rows = (deals ?? []) as { title: string; stage_id: string | null }[]
  if (rows.length === 0) return []
  const stageIds = rows.map((d) => d.stage_id).filter((x): x is string => Boolean(x))
  const stageName = new Map<string, string>()
  if (stageIds.length > 0) {
    const { data: stages } = await db.from('pipeline_stages').select('id, name').in('id', stageIds)
    for (const s of (stages ?? []) as { id: string; name: string }[]) stageName.set(s.id, s.name)
  }
  return rows.map((d) => ({ title: d.title, stage: d.stage_id ? stageName.get(d.stage_id) ?? null : null }))
}

// ------------------------------------------------------------
// For the AI
// ------------------------------------------------------------

const MAX_VALUE = 300
const MAX_PROFILE = 2500

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/**
 * The profile as plain lines for a prompt, or null when it says
 * nothing beyond the phone. Values are clipped; the whole block too.
 */
export function renderContactProfile(p: ContactProfile | null): string | null {
  if (!p) return null
  const lines: string[] = []
  const add = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${clip(value, MAX_VALUE)}`)
  }
  add('Nome', p.name)
  add('Empresa', p.company)
  add('Cargo', p.jobTitle)
  add('Segmento', p.segment)
  add('Cidade', p.city)
  add('E-mail', p.email)
  add('Instagram', p.instagram)
  add('Site', p.website)
  add('Origem', p.source)
  if (p.tags.length) add('Etiquetas', p.tags.join(', '))
  for (const d of p.deals) {
    add('Negócio aberto', d.stage ? `${d.title} (etapa ${d.stage})` : d.title)
  }
  if (p.fields.length) {
    lines.push('Campos:')
    for (const f of p.fields) lines.push(`- ${clip(f.name, 80)}: ${clip(f.value, MAX_VALUE)}`)
  }
  if (lines.length === 0) return null

  let out = lines.join('\n')
  if (out.length > MAX_PROFILE) out = `${out.slice(0, MAX_PROFILE - 1)}…`
  return out
}

// ------------------------------------------------------------
// For automation messages
// ------------------------------------------------------------

/**
 * `contato.*` and `campo.*` values for `{{ … }}` in automation
 * messages. A renamed lead field answers to both its keys.
 */
export function contactVariables(p: ContactProfile | null): Record<string, string> {
  if (!p) return {}
  const name = p.name ?? ''
  const vars: Record<string, string> = {
    'contato.nome': name,
    'contato.primeiro_nome': name.split(/\s+/)[0] ?? '',
    'contato.empresa': p.company ?? '',
    'contato.cidade': p.city ?? '',
    'contato.email': p.email ?? '',
    'contato.telefone': p.phone ?? '',
    'contato.cargo': p.jobTitle ?? '',
    'contato.instagram': p.instagram ?? '',
  }
  for (const f of p.fields) {
    if (f.key && !(`campo.${f.key}` in vars)) vars[`campo.${f.key}`] = f.value
    if (f.leadKey && !(`campo.${f.leadKey}` in vars)) vars[`campo.${f.leadKey}`] = f.value
  }
  return vars
}
