import type { SupabaseClient } from '@supabase/supabase-js'

import { runAutomationsForTrigger, triggerMatches } from '@/lib/automations/engine'
import { isOptedOut } from '@/lib/contacts/opt-out'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import type { Automation } from '@/types'
import type { NormalizedLead } from './parse'
import { buildLeadEventContext, leadVars } from './trigger'

// ============================================================
// "Lead recebido" — fired once per lead written (never for a repeat).
//
//   1. Outbound webhook `lead.received`, for the account's endpoints.
//   2. Automations with the `lead_received` trigger whose filters
//      match (origin, route, tags). Their steps send messages, start a
//      nurture, or hand the contact to the Agent SDR.
//
// Nothing that writes to the customer runs for a contact who asked not
// to receive automatic messages (066), or for a lead that explicitly
// refused consent. Best-effort: it never throws, because it runs after
// the sender already got its answer.
// ============================================================

export interface LeadReceivedEvent {
  accountId: string
  leadId: string
  contactId: string | null
  lead: NormalizedLead
}

export async function dispatchLeadReceived(
  admin: SupabaseClient,
  event: LeadReceivedEvent,
): Promise<void> {
  const ctx = buildLeadEventContext(event.lead, event.leadId)

  try {
    await dispatchWebhookEvent(admin, event.accountId, 'lead.received', {
      lead_id: event.leadId,
      contato_id: event.contactId,
      origem: ctx.origem ?? ctx.source,
      rota: ctx.rota,
      etiquetas: ctx.etiquetas,
      nome: event.lead.fullName,
      telefone: event.lead.phone,
      email: event.lead.email,
      campanha: event.lead.campaign,
    })
  } catch (err) {
    console.error('[lead received] webhook dispatch failed:', err)
  }

  if (!event.contactId) return
  if (ctx.consentimento === false) return

  try {
    const { data: contact } = await admin
      .from('contacts')
      .select('id, phone, name, opted_out_at')
      .eq('id', event.contactId)
      .eq('account_id', event.accountId)
      .maybeSingle()
    if (!contact || isOptedOut(contact as { opted_out_at?: unknown })) return

    const { data: automations, error } = await admin
      .from('automations')
      .select('id, trigger_type, trigger_config')
      .eq('account_id', event.accountId)
      .eq('trigger_type', 'lead_received')
      .eq('is_active', true)
    if (error) {
      console.error('[lead received] automations lookup failed:', error.message)
      return
    }
    const wanted = (automations ?? []).filter((a) =>
      triggerMatches(a as Automation, { lead: ctx }),
    )
    // No automation wants this lead: don't open an empty conversation.
    if (wanted.length === 0) return

    // Send steps need a conversation; a lead that never wrote has none.
    // Open it now — the same find-or-create the public API uses. No
    // WhatsApp connected: the automation still runs its other steps.
    let conversationId: string | undefined
    const row = contact as { phone?: string | null; name?: string | null }
    if (row.phone) {
      try {
        const resolved = await resolveConversationByPhone(
          admin,
          event.accountId,
          row.phone,
          row.name ?? null,
        )
        conversationId = resolved.conversationId
      } catch (err) {
        console.warn('[lead received] no conversation for the lead:', err)
      }
    }

    await runAutomationsForTrigger({
      accountId: event.accountId,
      triggerType: 'lead_received',
      contactId: event.contactId,
      context: {
        conversation_id: conversationId,
        lead: ctx,
        vars: leadVars(ctx),
      },
    })
  } catch (err) {
    console.error('[lead received] dispatch failed:', err)
  }
}
