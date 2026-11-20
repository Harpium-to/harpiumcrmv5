// ============================================================
// The full lists of one CRM for the agency's internal system
// (docs/plano-integracao-agency-os.md, Fase 5): leads, contatos,
// negócios, conversas (+ mensagens), tarefas and agenda.
//
// All personal data, so every list needs 'rows' (Leitura or
// membership) and is audited once per call. Same objects as the public
// API v1 (docs/public-api.md) plus a `link` that opens the item in the
// CRM. Service role: EVERY query filters `account_id`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { serializeContact, CONTACT_SELECT } from '@/lib/api/v1/contacts'
import { serializeConversation, serializeMessage } from '@/lib/api/v1/conversations'
import { DEAL_SELECT, DEAL_STATUSES, serializeDeal } from '@/lib/api/v1/deals'
import { buildPage, keysetFilter, parseListParams } from '@/lib/api/v1/pagination'
import { listTasks } from '@/lib/api/v1/tasks'
import { CONVERSATION_SELECT, normalizeConversation } from '@/lib/inbox/conversations'
import { leadTags, normalizeLead } from '@/lib/leads/parse'
import type { Conversation, Message } from '@/types'

import { isUuid } from './access'
import type { PlatformAuditAction } from './audit'
import { platformErrors } from './errors'
import { crmLink } from './links'
import { contactNames } from './resumo'

export const LIST_RESOURCES = [
  'leads',
  'contatos',
  'negocios',
  'conversas',
  'tarefas',
  'agenda',
] as const
export type ListResource = (typeof LIST_RESOURCES)[number]

export const LIST_AUDIT: Record<ListResource, PlatformAuditAction> = {
  leads: 'api_list_leads',
  contatos: 'api_list_contacts',
  negocios: 'api_list_deals',
  conversas: 'api_list_conversations',
  tarefas: 'api_list_tasks',
  agenda: 'api_list_agenda',
}

export interface ListPage {
  items: unknown[]
  nextCursor: string | null
  /** What was asked, in words, for the audit log. */
  detalhe: string | null
}

/** Free text for an ilike inside `.or()`: no PostgREST syntax gets through. */
export function sanitizeSearch(q: string | null): string {
  return (q ?? '').replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

function uuidParam(url: URL, name: string): string | null {
  const v = url.searchParams.get(name)
  if (v === null || v === '') return null
  if (!isUuid(v)) throw platformErrors.badRequest(`'${name}' inválido`)
  return v
}

function dateParam(url: URL, name: string): string | null {
  const v = url.searchParams.get(name)
  if (!v) return null
  const t = Date.parse(v)
  if (Number.isNaN(t)) throw platformErrors.badRequest(`'${name}' precisa ser uma data`)
  return new Date(t).toISOString()
}

type Paged = { created_at: string; id: string }

export async function loadList(
  admin: SupabaseClient,
  accountId: string,
  resource: ListResource,
  request: Request,
  origin: string,
  now: Date = new Date(),
): Promise<ListPage> {
  const url = new URL(request.url)
  const { limit, cursor } = parseListParams(request)
  const kf = keysetFilter(cursor)
  const link = (t: Parameters<typeof crmLink>[2]) => crmLink(origin, accountId, t)

  switch (resource) {
    case 'leads': {
      const desde = dateParam(url, 'desde')
      const origem = url.searchParams.get('origem')
      const busca = sanitizeSearch(url.searchParams.get('busca'))
      let q = admin
        .from('leads')
        .select('id, source, full_name, email, phone, campaign, form_name, contact_id, raw, created_at')
        .eq('account_id', accountId)
      if (desde) q = q.gte('created_at', desde)
      if (origem) q = q.eq('source', origem.slice(0, 80))
      if (busca) q = q.or(`full_name.ilike.*${busca}*,email.ilike.*${busca}*,phone.ilike.*${busca}*`)
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
      if (kf) q = q.or(kf)
      const { data, error } = await q
      if (error) throw error
      const page = buildPage((data ?? []) as unknown as Paged[], limit)
      return {
        items: (page.items as unknown as Array<Record<string, unknown>>).map((l) => {
          const n = normalizeLead(l.raw ?? {})
          return {
            id: l.id,
            origin: n.origin ?? l.source,
            source: l.source,
            route: n.route,
            tags: leadTags(n),
            campaign: (l.campaign as string | null) ?? n.campaign,
            formName: (l.form_name as string | null) ?? n.formName,
            name: (l.full_name as string | null) ?? n.fullName,
            email: (l.email as string | null) ?? n.email,
            phone: (l.phone as string | null) ?? n.phone,
            contactId: l.contact_id ?? null,
            createdAt: l.created_at,
            link: link({ kind: 'lead', id: String(l.id) }),
          }
        }),
        nextCursor: page.nextCursor,
        detalhe: [busca && `busca "${busca}"`, origem && `origem ${origem}`].filter(Boolean).join(', ') || null,
      }
    }

    case 'contatos': {
      const busca = sanitizeSearch(url.searchParams.get('busca'))
      const etiqueta = uuidParam(url, 'etiqueta')
      let q = admin
        .from('contacts')
        .select(etiqueta ? `${CONTACT_SELECT}, tag_filter:contact_tags!inner(tag_id)` : CONTACT_SELECT)
        .eq('account_id', accountId)
      if (busca) q = q.or(`name.ilike.*${busca}*,phone.ilike.*${busca}*,email.ilike.*${busca}*`)
      if (etiqueta) q = q.eq('tag_filter.tag_id', etiqueta)
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
      if (kf) q = q.or(kf)
      const { data, error } = await q
      if (error) throw error
      const page = buildPage((data ?? []) as unknown as Paged[], limit)
      return {
        items: (page.items as unknown as Array<Record<string, unknown>>).map((r) => ({
          ...serializeContact(r),
          link: link({ kind: 'contact', id: String(r.id) }),
        })),
        nextCursor: page.nextCursor,
        detalhe: busca ? `busca "${busca}"` : null,
      }
    }

    case 'negocios': {
      const pipeline = uuidParam(url, 'pipeline')
      const etapa = uuidParam(url, 'etapa')
      const status = url.searchParams.get('status')
      if (status && !(DEAL_STATUSES as readonly string[]).includes(status)) {
        throw platformErrors.badRequest(`'status' precisa ser um destes: ${DEAL_STATUSES.join(', ')}`)
      }
      let q = admin.from('deals').select(DEAL_SELECT).eq('account_id', accountId)
      if (pipeline) q = q.eq('pipeline_id', pipeline)
      if (etapa) q = q.eq('stage_id', etapa)
      if (status) q = q.eq('status', status)
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
      if (kf) q = q.or(kf)
      const { data, error } = await q
      if (error) throw error
      const page = buildPage((data ?? []) as unknown as Paged[], limit)
      return {
        items: (page.items as unknown as Array<Record<string, unknown>>).map((r) => ({
          ...serializeDeal(r),
          link: link({
            kind: 'deal',
            id: String(r.id),
            pipelineId: (r.pipeline_id as string | null) ?? null,
          }),
        })),
        nextCursor: page.nextCursor,
        detalhe: status ? `status ${status}` : null,
      }
    }

    case 'conversas': {
      const status = url.searchParams.get('status')
      if (status && !['open', 'pending', 'closed'].includes(status)) {
        throw platformErrors.badRequest("'status' precisa ser open, pending ou closed")
      }
      const esperando = url.searchParams.get('esperando') === '1'
      let q = admin.from('conversations').select(CONVERSATION_SELECT).eq('account_id', accountId)
      if (status) q = q.eq('status', status)
      if (esperando) q = q.neq('status', 'closed').not('needs_human_since', 'is', null)
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
      if (kf) q = q.or(kf)
      const { data, error } = await q
      if (error) throw error
      const page = buildPage((data ?? []) as unknown as Paged[], limit)
      return {
        items: (page.items as unknown as Array<Record<string, unknown>>).map((r) => ({
          ...serializeConversation(normalizeConversation(r as unknown as Conversation)),
          waitingSince: (r.needs_human_since as string | null) ?? null,
          link: link({ kind: 'conversation', id: String(r.id) }),
        })),
        nextCursor: page.nextCursor,
        detalhe: esperando ? 'esperando atendente' : status ? `status ${status}` : null,
      }
    }

    case 'tarefas': {
      const situacao = url.searchParams.get('situacao') ?? 'aberta'
      if (!['aberta', 'atrasada', 'feita'].includes(situacao)) {
        throw platformErrors.badRequest("'situacao' precisa ser aberta, atrasada ou feita")
      }
      const tasks = await listTasks(admin, accountId, {
        status: situacao === 'feita' ? 'done' : 'open',
      })
      const nowIso = now.toISOString()
      const shown =
        situacao === 'atrasada' ? tasks.filter((t) => t.due_at && t.due_at < nowIso) : tasks
      return {
        items: shown.map((t) => ({
          ...t,
          link: t.contact_id
            ? link({ kind: 'contact', id: t.contact_id })
            : link({ kind: 'page', path: '/contacts' }),
        })),
        nextCursor: null,
        detalhe: situacao,
      }
    }

    case 'agenda': {
      const de = dateParam(url, 'de') ?? new Date(now.getTime() - 86_400_000).toISOString()
      const ate = dateParam(url, 'ate') ?? new Date(Date.parse(de) + 14 * 86_400_000).toISOString()
      if (Date.parse(ate) <= Date.parse(de)) throw platformErrors.badRequest("'ate' precisa vir depois de 'de'")
      if (Date.parse(ate) - Date.parse(de) > 31 * 86_400_000) {
        throw platformErrors.badRequest('A agenda vai até 31 dias por consulta')
      }
      const { data, error } = await admin
        .from('calendar_events')
        .select('id, title, kind, status, starts_at, ends_at, calendar_id, contact_id')
        .eq('account_id', accountId)
        .eq('kind', 'appointment')
        .gte('starts_at', de)
        .lt('starts_at', ate)
        .order('starts_at', { ascending: true })
        .limit(500)
      if (error) throw error
      const events = (data ?? []) as Array<{
        id: string
        title: string | null
        status: string
        starts_at: string
        ends_at: string
        calendar_id: string | null
        contact_id: string | null
      }>
      const calendarIds = Array.from(
        new Set(events.map((e) => e.calendar_id).filter((v): v is string => Boolean(v))),
      )
      const [names, calendarsRes] = await Promise.all([
        contactNames(admin, accountId, events.map((e) => e.contact_id)),
        calendarIds.length
          ? admin.from('calendars').select('id, name').eq('account_id', accountId).in('id', calendarIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      const calendarName = new Map(
        ((calendarsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
      )
      return {
        items: events.map((e) => ({
          id: e.id,
          title: e.title,
          status: e.status,
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          calendar: e.calendar_id ? (calendarName.get(e.calendar_id) ?? null) : null,
          contactName: e.contact_id ? (names.get(e.contact_id) ?? null) : null,
          link: link({ kind: 'event', id: e.id, startsAt: e.starts_at }),
        })),
        nextCursor: null,
        detalhe: `${de.slice(0, 10)} a ${ate.slice(0, 10)}`,
      }
    }
  }
}

/** Messages of one conversation of the CRM (newest first). */
export async function loadMessages(
  admin: SupabaseClient,
  accountId: string,
  conversationId: string,
  request: Request,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  if (!isUuid(conversationId)) throw platformErrors.notFound('Conversa não encontrada')
  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!conv) throw platformErrors.notFound('Conversa não encontrada')

  const { limit, cursor } = parseListParams(request)
  let q = admin
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  const kf = keysetFilter(cursor)
  if (kf) q = q.or(kf)
  const { data, error } = await q
  if (error) throw error
  const page = buildPage((data ?? []) as unknown as Paged[], limit)
  return {
    items: page.items.map((m) => serializeMessage(m as unknown as Message)),
    nextCursor: page.nextCursor,
  }
}
