import type { SupabaseClient } from '@supabase/supabase-js'

import { assignImportedContactTags, resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { REPLIED_TAG } from '@/lib/extractor/lead'
import { openLeadDeal } from '@/lib/leads/deal'
import { dispatchLeadReceived } from '@/lib/leads/events'
import { normalizeLead } from '@/lib/leads/parse'

// ============================================================
// A cold lead wrote back to a prospecting send.
//
// Called by the QR-code inbound path for every customer message; it
// does something only for a contact who received a prospecting message
// and had not replied yet:
//
//   - "SAIR" (and the usual ways of saying it): the contact is marked
//     as not wanting automatic messages (066), which also puts the
//     number on the block list (073). Nothing else.
//   - anything else: the reply is recorded (the campaign's report and
//     its brake read it), the contact gets the "respondeu" tag, the card
//     opens in the funnel — the extractor leaves it out until now — and
//     "lead recebido" fires with the lead's origin, so an automation
//     filtered on "Extrator · …" can hand it to the Agent SDR.
//
// Never throws: the message is already stored when this runs.
// ============================================================

const OPT_OUT = [
  'sair',
  'sai',
  'pare',
  'parar',
  'para',
  'stop',
  'cancelar',
  'descadastrar',
  'remover',
  'me remova',
  'me remove',
  'me tira',
  'me tire',
  'me tira da lista',
  'me tire da lista',
  'nao quero',
  'nao quero receber',
  'nao tenho interesse',
  'sem interesse',
  'nao envie mais',
  'nao mande mais',
]

/** A reply that asks to stop. Only short, whole answers count. Pure. */
export function isOptOutReply(text: string | null | undefined): boolean {
  const folded = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!folded || folded.length > 40) return false
  const withoutThanks = folded.replace(/\s*(obrigad[oa]|obg|por favor|pfv|pf)$/, '').trim()
  return OPT_OUT.includes(withoutThanks)
}

export type ProspectReplyOutcome = 'not_prospect' | 'already_replied' | 'opted_out' | 'replied'

export async function handleProspectReply(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  contactId: string,
  text: string | null,
): Promise<ProspectReplyOutcome> {
  try {
    const { data: rows, error } = await admin
      .from('scheduled_messages')
      .select('id, bulk_send_id, replied_at')
      .eq('account_id', account.id)
      .eq('contact_id', contactId)
      .eq('status', 'sent')
      .not('bulk_send_id', 'is', null)
    // Before 073 there is no replied_at: nothing to do.
    if (error || !rows || rows.length === 0) return 'not_prospect'

    const bulkIds = [...new Set((rows as { bulk_send_id: string }[]).map((r) => r.bulk_send_id))]
    const { data: bulks } = await admin
      .from('bulk_sends')
      .select('id')
      .in('id', bulkIds)
      .eq('mode', 'prospeccao')
    const prospectIds = new Set(((bulks ?? []) as { id: string }[]).map((b) => b.id))
    const mine = (rows as { id: string; bulk_send_id: string; replied_at: string | null }[]).filter((r) =>
      prospectIds.has(r.bulk_send_id),
    )
    if (mine.length === 0) return 'not_prospect'
    const pending = mine.filter((r) => !r.replied_at)
    if (pending.length === 0) return 'already_replied'

    const now = new Date().toISOString()
    await admin
      .from('scheduled_messages')
      .update({ replied_at: now })
      .in(
        'id',
        pending.map((r) => r.id),
      )

    if (isOptOutReply(text)) {
      await admin
        .from('contacts')
        .update({ opted_out_at: now, updated_at: now })
        .eq('id', contactId)
        .eq('account_id', account.id)
        .is('opted_out_at', null)
      // Whatever was still waiting for this contact does not go.
      await admin
        .from('scheduled_messages')
        .update({ status: 'cancelled', outcome: 'O contato respondeu SAIR.', processed_at: now })
        .eq('account_id', account.id)
        .eq('contact_id', contactId)
        .eq('status', 'scheduled')
        .not('bulk_send_id', 'is', null)
      return 'opted_out'
    }

    try {
      const { tagIdByKey } = await resolveImportTagIds(admin, {
        accountId: account.id,
        userId: account.ownerUserId,
        tagNames: [REPLIED_TAG],
        canCreateTags: true,
      })
      await assignImportedContactTags(admin, [{ contactId, tagNames: [REPLIED_TAG] }], tagIdByKey)
    } catch (err) {
      console.error('[prospect reply] tag failed:', err)
    }

    // The lead the extractor wrote for this contact: its origin titles
    // the card and drives "lead recebido".
    const { data: lead } = await admin
      .from('leads')
      .select('id, source, raw')
      .eq('account_id', account.id)
      .eq('contact_id', contactId)
      .like('source', 'extrator-%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const stored = lead as { id: string; source: string; raw: unknown } | null
    const normalized = stored?.raw ? normalizeLead(stored.raw) : null
    await openLeadDeal(admin, account, contactId, {
      source: normalized?.source ?? stored?.source ?? 'other',
      origin: normalized?.origin ?? 'Prospecção',
    })
    if (stored && normalized) {
      await dispatchLeadReceived(admin, {
        accountId: account.id,
        leadId: stored.id,
        contactId,
        lead: normalized,
      })
    }
    return 'replied'
  } catch (err) {
    console.error('[prospect reply] failed:', err)
    return 'not_prospect'
  }
}
