import type { SupabaseClient } from '@supabase/supabase-js'

import { DEFAULT_PIPELINE_NAME, DEFAULT_PIPELINE_STAGES } from './default-pipeline'

// ============================================================
// A new contact lands in the funnel on their first message.
//
// Every inbound channel (WhatsApp Cloud API, Evolution, UAZAPI,
// Instagram) calls this right after it OPENED the contact's first
// conversation — i.e. the call whose insert created the row. The
// conversations table is unique on (account_id, contact_id) since
// migration 036, so exactly one delivery wins that insert even when a
// new contact sends two messages at once: that is what keeps this to
// one deal per contact without a lock or a migration.
//
// Deliberately NOT tied to "contact was created": someone imported by
// CSV who writes for the first time is a first contact too. And a
// thread the team opened (a template sent, a reply from the phone in
// coexistence / UAZAPI) is not — the operator started that one and
// handles the funnel by hand.
//
// Always on, no per-account switch. Target is the account's oldest
// funnel, at its first stage; an account that has no funnel yet gets
// the default one, the same the Funil page would seed on first open.
//
// Service-role client (the webhooks have no session). Never throws:
// callers run inside the webhook and a failure here must not drop the
// message.
// ============================================================

export interface FirstContactDealInput {
  accountId: string
  /** NOT NULL audit column on deals / pipelines — the channel owner. */
  ownerUserId: string
  contactId: string
  conversationId: string
  /** Overrides the contact's name as the deal title. Instagram passes
   *  one because its contacts arrive with no name. */
  title?: string
}

export type FirstContactDealOutcome =
  | 'created'
  | 'has_open_deal'
  | 'no_stage'
  | 'contact_not_found'
  | 'error'

export async function openFirstContactDeal(
  admin: SupabaseClient,
  input: FirstContactDealInput,
): Promise<FirstContactDealOutcome> {
  try {
    // Account-scoped read: confirms the contact is this tenant's and
    // gives us its name for the card title.
    const { data: contact, error: contactErr } = await admin
      .from('contacts')
      .select('name, phone')
      .eq('id', input.contactId)
      .eq('account_id', input.accountId)
      .maybeSingle()
    if (contactErr) throw contactErr
    if (!contact) return 'contact_not_found'

    // Someone may already have put this person in the funnel (by hand,
    // through the API, from a lead form). One open card per contact.
    const { data: openDeals, error: openErr } = await admin
      .from('deals')
      .select('id')
      .eq('account_id', input.accountId)
      .eq('contact_id', input.contactId)
      .eq('status', 'open')
      .limit(1)
    if (openErr) throw openErr
    if (openDeals && openDeals.length > 0) return 'has_open_deal'

    const target = await resolveFirstStage(admin, input.accountId, input.ownerUserId)
    if (!target) return 'no_stage'

    // Same currency rule as every other deal: the account's default.
    const { data: account } = await admin
      .from('accounts')
      .select('default_currency')
      .eq('id', input.accountId)
      .maybeSingle()

    const title =
      input.title?.trim() ||
      String(contact.name ?? '').trim() ||
      String(contact.phone ?? '').trim() ||
      'Novo contato'

    const { error: insertErr } = await admin.from('deals').insert({
      account_id: input.accountId,
      user_id: input.ownerUserId,
      pipeline_id: target.pipelineId,
      stage_id: target.stageId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      title,
      value: 0,
      // Omitted when unknown so the column default applies.
      ...(account?.default_currency ? { currency: account.default_currency } : {}),
      status: 'open',
    })
    if (insertErr) throw insertErr
    return 'created'
  } catch (err) {
    console.error('[first-contact deal] failed:', err)
    return 'error'
  }
}

interface StageTarget {
  pipelineId: string
  stageId: string
}

/**
 * The account's oldest funnel that has at least one stage, at its
 * lowest-position stage. Seeds the default funnel when the account has
 * none at all. Funnels that exist but are all empty of stages are left
 * alone (someone set it up that way) and yield null.
 */
async function resolveFirstStage(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
): Promise<StageTarget | null> {
  const { data: pipelines, error: pipeErr } = await admin
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (pipeErr) throw pipeErr

  if (!pipelines || pipelines.length === 0) {
    return seedDefaultPipeline(admin, accountId, ownerUserId)
  }

  const ids = pipelines.map((p) => p.id as string)
  const { data: stages, error: stageErr } = await admin
    .from('pipeline_stages')
    .select('id, pipeline_id, position')
    .in('pipeline_id', ids)
    .order('position', { ascending: true })
  if (stageErr) throw stageErr

  for (const pipelineId of ids) {
    const first = (stages ?? []).find((s) => s.pipeline_id === pipelineId)
    if (first) return { pipelineId, stageId: first.id as string }
  }
  return null
}

/**
 * Create the default funnel. Two brand-new contacts writing in the same
 * instant to an account with no funnel can each seed one; that rare
 * duplicate is left for a person to delete rather than having a webhook
 * delete a funnel (deals cascade with it).
 */
async function seedDefaultPipeline(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
): Promise<StageTarget | null> {
  const { data: pipeline, error: pipeErr } = await admin
    .from('pipelines')
    .insert({ user_id: ownerUserId, account_id: accountId, name: DEFAULT_PIPELINE_NAME })
    .select('id')
    .single()
  if (pipeErr) throw pipeErr

  const { data: stages, error: stageErr } = await admin
    .from('pipeline_stages')
    .insert(
      DEFAULT_PIPELINE_STAGES.map((s) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color,
        position: s.position,
      })),
    )
    .select('id, position')
  if (stageErr) throw stageErr

  const first = [...(stages ?? [])].sort(
    (a, b) => (a.position as number) - (b.position as number),
  )[0]
  if (!first) return null
  return { pipelineId: pipeline.id as string, stageId: first.id as string }
}
