import type { SupabaseClient } from '@supabase/supabase-js'

import { phoneKeys } from './phone'
import type { ExtractedLead, ExtractionSource, ResultStatus } from './types'

// ============================================================
// What an extracted lead is against the CRM (plan: "Duplicados e
// origem"). In this order:
//
//   bloqueado     the number asked not to be contacted
//   contato       the number already is a contact of this CRM
//   extraido      it came in an earlier extraction of this CRM (the
//                 same CNPJ or place), or the same number is already
//                 on another extracted row
//   sem_telefone  nothing to write or call to
//   novo          none of the above
//
// "The same number" is the CRM's own rule (equivalentPhoneKeys): with
// or without the ninth digit.
// ============================================================

export interface CrmKnowledge {
  /** Blocked numbers, by key. */
  blocked: Set<string>
  /** Contacts of the CRM: phone key → contact id. */
  contacts: Map<string, string>
  /** Source keys (CNPJ, place id) extracted before. */
  extractedKeys: Set<string>
  /** Numbers extracted before, by key. */
  extractedPhones: Set<string>
}

export interface Classified {
  status: ResultStatus
  matchedContactId: string | null
}

/** Pure: the status of one lead, given what the CRM knows. */
export function classifyLead(lead: ExtractedLead, known: CrmKnowledge): Classified {
  const keys = phoneKeys(lead.phone)
  if (keys.some((k) => known.blocked.has(k))) return { status: 'bloqueado', matchedContactId: null }
  for (const key of keys) {
    const contactId = known.contacts.get(key)
    if (contactId) return { status: 'contato', matchedContactId: contactId }
  }
  if (known.extractedKeys.has(lead.externalKey) || keys.some((k) => known.extractedPhones.has(k))) {
    return { status: 'extraido', matchedContactId: null }
  }
  if (!lead.phone) return { status: 'sem_telefone', matchedContactId: null }
  return { status: 'novo', matchedContactId: null }
}

const CHUNK = 300

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/**
 * What the CRM knows about these leads: who is blocked, who is a
 * contact, who came in another extraction. Service-role client.
 */
export async function loadCrmKnowledge(
  admin: SupabaseClient,
  accountId: string,
  extractionId: string,
  source: ExtractionSource,
  leads: ExtractedLead[],
): Promise<CrmKnowledge> {
  const known: CrmKnowledge = {
    blocked: new Set(),
    contacts: new Map(),
    extractedKeys: new Set(),
    extractedPhones: new Set(),
  }
  const phones = [...new Set(leads.flatMap((l) => phoneKeys(l.phone)))]
  const keys = [...new Set(leads.map((l) => l.externalKey))]

  for (const part of chunks(phones)) {
    const [blocked, contacts, extracted] = await Promise.all([
      admin
        .from('prospecting_blocklist')
        .select('phone_normalized')
        .eq('account_id', accountId)
        .in('phone_normalized', part),
      admin.from('contacts').select('id, phone_normalized').eq('account_id', accountId).in('phone_normalized', part),
      admin
        .from('lead_extraction_results')
        .select('phone_normalized')
        .eq('account_id', accountId)
        .in('phone_normalized', part),
    ])
    if (contacts.error) throw new Error(contacts.error.message)
    for (const row of (blocked.data ?? []) as { phone_normalized: string }[]) {
      known.blocked.add(row.phone_normalized)
    }
    for (const row of (contacts.data ?? []) as { id: string; phone_normalized: string }[]) {
      known.contacts.set(row.phone_normalized, row.id)
    }
    for (const row of (extracted.data ?? []) as { phone_normalized: string }[]) {
      known.extractedPhones.add(row.phone_normalized)
    }
  }

  for (const part of chunks(keys)) {
    const { data } = await admin
      .from('lead_extraction_results')
      .select('external_key')
      .eq('account_id', accountId)
      .eq('source', source)
      .neq('extraction_id', extractionId)
      .in('external_key', part)
    for (const row of (data ?? []) as { external_key: string }[]) known.extractedKeys.add(row.external_key)
  }
  return known
}
