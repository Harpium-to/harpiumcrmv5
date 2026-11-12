import type { SupabaseClient } from '@supabase/supabase-js'

import { openFirstContactDeal, type FirstContactDealOutcome } from '@/lib/deals/first-contact'
import type { NormalizedLead } from './parse'

// ============================================================
// A received lead lands in the funnel.
//
// Every lead written with a contact (Meta Lead Ads, Google, the
// Harpium Lead v1 webhook, Zapier, any form) gets a card in the first
// stage of the account's oldest funnel — the same rule as a new
// WhatsApp contact (lib/deals/first-contact.ts), so a lead who later
// writes on WhatsApp doesn't get a second card, and neither does a
// repeat lead from someone who already has an open one.
//
// Runs before "lead recebido" (events.ts), so a "Criar negócio"
// automation on that trigger finds the card and doesn't add another.
//
// Never throws: the lead is already stored when this runs.
// ============================================================

/** "Meta", "Google", "quiz-planejados", "formulário". */
export function leadOriginLabel(lead: Pick<NormalizedLead, 'source' | 'origin'>): string {
  if (lead.source === 'meta') return 'Meta'
  if (lead.source === 'google') return 'Google'
  const origin = lead.origin?.trim()
  if (origin && origin.toLowerCase() !== 'other') return origin
  return lead.source && lead.source !== 'other' ? lead.source : 'formulário'
}

export async function openLeadDeal(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  contactId: string,
  lead: Pick<NormalizedLead, 'source' | 'origin'>,
): Promise<FirstContactDealOutcome> {
  // A contact who has already written has a thread; the card opens it.
  let conversationId: string | null = null
  try {
    const { data } = await admin
      .from('conversations')
      .select('id')
      .eq('account_id', account.id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
    conversationId = ((data ?? []) as { id: string }[])[0]?.id ?? null
  } catch (err) {
    console.error('[lead deal] conversation lookup failed:', err)
  }

  return openFirstContactDeal(admin, {
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    contactId,
    conversationId,
    titlePrefix: `Lead ${leadOriginLabel(lead)} · `,
  })
}
