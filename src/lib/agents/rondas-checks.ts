import type { SupabaseClient } from '@supabase/supabase-js'

import { rondaParam, type RondaKind } from './rondas-catalogo'

// ============================================================
// What each round looks for — plain queries, no AI.
//
// This is what keeps a round cheap: the database finds the cases, and
// the model is only called for what it found. An empty round costs a
// few selects and nothing on the client's AI key.
//
// Every query is scoped to one CRM by `account_id` explicitly: this
// runs under the service role, where RLS does not apply.
// ============================================================

export interface Candidate {
  contactId: string
  conversationId: string | null
  dealId: string | null
  /** Who, for the task title: the contact's name. */
  label: string
  /** What the round found, in one sentence for the agent. */
  situacao: string
}

type Row = Record<string, unknown>

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Rows read per check; the scheduler keeps `max_per_run` of them. */
const SCAN = 40

const iso = (ms: number) => new Date(ms).toISOString()
const nameOf = (row: Row) => String(((row.contact as Row | null)?.name as string | undefined) ?? 'cliente')

function ago(fromIso: string, now: Date): string {
  const ms = now.getTime() - new Date(fromIso).getTime()
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} minutos`
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} horas`
  return `${Math.round(ms / DAY)} dias`
}

function when(isoValue: string, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(isoValue))
}

/** Who sent the last message of each conversation. */
async function lastSenders(db: SupabaseClient, conversationIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(
    conversationIds.map(async (id) => {
      const { data } = await db
        .from('messages')
        .select('sender_type')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
      const sender = ((data ?? []) as Row[])[0]?.sender_type
      if (typeof sender === 'string') out.set(id, sender)
    }),
  )
  return out
}

async function conversationsByLastSender(
  db: SupabaseClient,
  accountId: string,
  opts: { from: number; to: number; sender: 'customer' | 'business'; unassignedOnly: boolean },
): Promise<Row[]> {
  let q = db
    .from('conversations')
    .select('id, contact_id, last_message_at, assigned_agent_id, ai_autoreply_disabled, contact:contacts(name)')
    .eq('account_id', accountId)
    .in('status', ['open', 'pending'])
    .gte('last_message_at', iso(opts.from))
    .lte('last_message_at', iso(opts.to))
    .not('contact_id', 'is', null)
    .order('last_message_at', { ascending: false })
    .limit(SCAN)
  if (opts.unassignedOnly) q = q.is('assigned_agent_id', null)
  const { data, error } = await q
  if (error) throw error
  const rows = ((data ?? []) as Row[]).filter((r) => !(opts.unassignedOnly && r.ai_autoreply_disabled === true))
  const senders = await lastSenders(db, rows.map((r) => String(r.id)))
  return rows.filter((r) => {
    const s = senders.get(String(r.id))
    if (!s) return false
    return opts.sender === 'customer' ? s === 'customer' : s !== 'customer'
  })
}

export async function findCandidates(
  db: SupabaseClient,
  args: { accountId: string; kind: RondaKind; params: Record<string, unknown>; now: Date; timezone: string },
): Promise<Candidate[]> {
  const { accountId, kind, now, timezone } = args
  const t = now.getTime()
  const n = rondaParam(kind, args.params)

  switch (kind) {
    case 'conversas_sem_resposta': {
      // A person's conversation is that person's; one the AI was told
      // to stay out of stays that way.
      const rows = await conversationsByLastSender(db, accountId, {
        from: t - 7 * DAY,
        to: t - (n ?? 2) * HOUR,
        sender: 'customer',
        unassignedOnly: true,
      })
      return rows.map((r) => ({
        contactId: String(r.contact_id),
        conversationId: String(r.id),
        dealId: null,
        label: nameOf(r),
        situacao: `O cliente escreveu por último, há ${ago(String(r.last_message_at), now)}, e ninguém respondeu.`,
      }))
    }

    case 'cliente_sumido': {
      const rows = await conversationsByLastSender(db, accountId, {
        from: t - 30 * DAY,
        to: t - (n ?? 5) * DAY,
        sender: 'business',
        unassignedOnly: false,
      })
      return rows.map((r) => ({
        contactId: String(r.contact_id),
        conversationId: String(r.id),
        dealId: null,
        label: nameOf(r),
        situacao: `A última mensagem foi da empresa, há ${ago(String(r.last_message_at), now)}, e o cliente não respondeu.`,
      }))
    }

    case 'lead_sem_contato': {
      const { data, error } = await db
        .from('leads')
        .select('id, contact_id, source, form_name, campaign, created_at, contact:contacts(name)')
        .eq('account_id', accountId)
        .not('contact_id', 'is', null)
        .gte('created_at', iso(t - 3 * DAY))
        .lte('created_at', iso(t - (n ?? 15) * 60_000))
        .order('created_at', { ascending: false })
        .limit(SCAN)
      if (error) throw error
      const out: Candidate[] = []
      const seen = new Set<string>()
      for (const lead of (data ?? []) as Row[]) {
        const contactId = String(lead.contact_id)
        if (seen.has(contactId)) continue
        seen.add(contactId)
        const { data: convs } = await db
          .from('conversations')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
        const ids = ((convs ?? []) as Row[]).map((c) => String(c.id))
        if (ids.length > 0) {
          const { data: sent } = await db
            .from('messages')
            .select('id')
            .in('conversation_id', ids)
            .neq('sender_type', 'customer')
            .gte('created_at', String(lead.created_at))
            .limit(1)
          if ((sent ?? []).length > 0) continue
        }
        const origem = [lead.form_name, lead.campaign, lead.source].filter(Boolean).join(' · ') || 'um formulário'
        out.push({
          contactId,
          conversationId: ids[0] ?? null,
          dealId: null,
          label: nameOf(lead),
          situacao: `Chegou como lead (${origem}) há ${ago(String(lead.created_at), now)} e ainda não recebeu nenhuma mensagem da empresa.`,
        })
      }
      return out
    }

    case 'orcamento_parado': {
      const { data, error } = await db
        .from('deals')
        .select('id, title, value, contact_id, updated_at, stage:pipeline_stages(name), contact:contacts(name)')
        .eq('account_id', accountId)
        .eq('status', 'open')
        .not('contact_id', 'is', null)
        .lte('updated_at', iso(t - (n ?? 3) * DAY))
        .gte('updated_at', iso(t - 60 * DAY))
        .order('updated_at', { ascending: true })
        .limit(SCAN)
      if (error) throw error
      return ((data ?? []) as Row[]).map((d) => ({
        contactId: String(d.contact_id),
        conversationId: null,
        dealId: String(d.id),
        label: nameOf(d),
        situacao: `O negócio "${String(d.title)}" (etapa ${String((d.stage as Row | null)?.name ?? '?')}, valor ${Number(d.value ?? 0)}) está parado há ${ago(String(d.updated_at), now)}.`,
      }))
    }

    case 'pos_venda': {
      const days = n ?? 30
      const { data, error } = await db
        .from('deals')
        .select('id, title, contact_id, closed_at, contact:contacts(name)')
        .eq('account_id', accountId)
        .eq('status', 'won')
        .not('contact_id', 'is', null)
        .lte('closed_at', iso(t - days * DAY))
        .gte('closed_at', iso(t - (days + 3) * DAY))
        .limit(SCAN)
      if (error) throw error
      return ((data ?? []) as Row[]).map((d) => ({
        contactId: String(d.contact_id),
        conversationId: null,
        dealId: String(d.id),
        label: nameOf(d),
        situacao: `Fechou o negócio "${String(d.title)}" há ${ago(String(d.closed_at), now)}.`,
      }))
    }

    case 'reuniao_sem_confirmacao':
    case 'falta_na_agenda': {
      const confirm = kind === 'reuniao_sem_confirmacao'
      let q = db
        .from('calendar_events')
        .select('id, title, starts_at, contact_id, contact:contacts(name)')
        .eq('account_id', accountId)
        .eq('kind', 'appointment')
        .not('contact_id', 'is', null)
        .limit(SCAN)
      q = confirm
        ? q.eq('status', 'scheduled').eq('notify', true).gte('starts_at', iso(t + 12 * HOUR)).lte('starts_at', iso(t + 36 * HOUR))
        : q.eq('status', 'no_show').gte('starts_at', iso(t - 3 * DAY)).lte('starts_at', iso(t))
      const { data, error } = await q
      if (error) throw error
      return ((data ?? []) as Row[]).map((e) => ({
        contactId: String(e.contact_id),
        conversationId: null,
        dealId: null,
        label: nameOf(e),
        situacao: confirm
          ? `Tem o compromisso "${String(e.title ?? 'compromisso')}" em ${when(String(e.starts_at), timezone)} e ainda não confirmou.`
          : `Faltou ao compromisso "${String(e.title ?? 'compromisso')}" de ${when(String(e.starts_at), timezone)}.`,
      }))
    }
  }
}
