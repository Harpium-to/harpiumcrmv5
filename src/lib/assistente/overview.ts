import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { getInstagramConfig } from '@/lib/instagram/config'
import { triggerMeta } from '@/lib/automations/trigger-meta'
import { variableKey } from '@/lib/contacts/profile'

import type { ToolContext } from './types'

// ============================================================
// The map of the CRM, as compact text for the model.
//
// It goes into every turn, so the model knows the funnels and their
// stage ids, the tags, the fields, what is connected — without
// spending a tool call to find out. Everything else (contacts, deals,
// numbers) it fetches with tools, so this stays small.
//
// Each piece is read on its own and a failing one is just left out:
// an older database without some table still gets a useful map.
// Cached per CRM for a minute (per server instance).
// ============================================================

type Row = Record<string, unknown>

const TTL_MS = 60_000
const cache = new Map<string, { at: number; text: string }>()

export function clearOverviewCache(accountId?: string): void {
  if (accountId) cache.delete(accountId)
  else cache.clear()
}

async function safe<T>(fn: () => PromiseLike<T> | T, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

export async function buildOverview(ctx: ToolContext): Promise<string> {
  const hit = cache.get(ctx.accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text

  const [account, pipes, tags, fields, automations, agents, calendars, quizzes, leadSources, flows, contacts, openDeals, whatsapp, instagram] =
    await Promise.all([
      safe(async () => (await ctx.db.from('accounts').select('name, default_currency').eq('id', ctx.accountId).maybeSingle()).data as Row | null, null),
      safe(async () => (await ctx.db.from('pipelines').select('id, name, pipeline_stages(id, name, position)').eq('account_id', ctx.accountId).order('created_at').limit(20)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('tags').select('name').eq('account_id', ctx.accountId).order('name').limit(150)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('custom_fields').select('id, field_name, field_key, field_type').eq('account_id', ctx.accountId).limit(60)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('automations').select('id, name, trigger_type, is_active').eq('account_id', ctx.accountId).order('created_at', { ascending: false }).limit(40)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('agents').select('id, name, role, is_active').eq('account_id', ctx.accountId).limit(20)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('calendars').select('id, name, is_active, slot_minutes').eq('account_id', ctx.accountId).limit(15)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('quizzes').select('name, status').eq('account_id', ctx.accountId).limit(20)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('lead_ingest_tokens').select('name').eq('account_id', ctx.accountId).is('revoked_at', null).limit(20)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('flows').select('name, status').eq('account_id', ctx.accountId).limit(20)).data as Row[] | null, null),
      safe(async () => (await ctx.db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId)).count, null),
      safe(async () => (await ctx.db.from('deals').select('id', { count: 'exact', head: true }).eq('account_id', ctx.accountId).eq('status', 'open')).count, null),
      safe(() => resolveWhatsAppProvider(ctx.admin, ctx.accountId), null),
      safe(() => getInstagramConfig(ctx.admin, ctx.accountId), null),
    ])

  const lines: string[] = []
  lines.push(`CRM: ${account?.name ?? '?'} · moeda ${account?.default_currency ?? 'BRL'}`)
  if (contacts !== null || openDeals !== null) {
    lines.push(`Tamanho: ${contacts ?? '?'} contatos, ${openDeals ?? '?'} negócios em aberto.`)
  }
  const wa =
    whatsapp === 'meta'
      ? 'API oficial da Meta (envio fora da janela de 24h só com modelo aprovado)'
      : whatsapp === 'uazapi'
        ? 'QR code (uazapi)'
        : whatsapp === 'evolution'
          ? 'QR code (Evolution)'
          : 'nenhum conectado'
  lines.push(`Canais: WhatsApp ${wa}; Instagram ${instagram ? 'conectado' : 'não conectado'}.`)

  if (pipes?.length) {
    lines.push('Funis (id) › etapas em ordem (id):')
    for (const p of pipes) {
      const stages = ((p.pipeline_stages ?? []) as Row[])
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((s) => `${s.name} [${s.id}]`)
      lines.push(`- ${p.name} [${p.id}]: ${stages.join(' › ') || '(sem etapas)'}`)
    }
  } else if (pipes) {
    lines.push('Funis: nenhum ainda.')
  }

  if (tags) lines.push(`Etiquetas: ${tags.map((t) => t.name).join(', ') || 'nenhuma'}.`)
  if (fields?.length) {
    lines.push(
      `Campos personalizados: ${fields
        .map((f) => `${f.field_name} [${f.id}] (variável {{ campo.${variableKey(String(f.field_name))} }})`)
        .join(', ')}.`,
    )
  }
  if (automations) {
    const on = automations.filter((a) => a.is_active).length
    lines.push(
      `Automações (${automations.length}, ${on} ligadas): ${automations
        .map((a) => `${a.name} [${a.id}] (${triggerMeta(String(a.trigger_type)).label}${a.is_active ? ', ligada' : ', desligada'})`)
        .join('; ') || 'nenhuma'}.`,
    )
  }
  if (agents) {
    lines.push(
      `Agentes de IA: ${agents.map((a) => `${a.name} [${a.id}] (${a.role}${a.is_active ? ', ligado' : ', desligado'})`).join('; ') || 'nenhum'}.`,
    )
  }
  if (calendars?.length) {
    lines.push(
      `Agendas: ${calendars.map((c) => `${c.name} [${c.id}] (${c.slot_minutes} min${c.is_active ? '' : ', inativa'})`).join('; ')}.`,
    )
  }
  if (quizzes?.length) lines.push(`Quizzes (o nome vira a origem do lead): ${quizzes.map((q) => q.name).join(', ')}.`)
  if (leadSources?.length) lines.push(`URLs de lead (origens): ${leadSources.map((l) => l.name).join(', ')}.`)
  if (flows?.length) lines.push(`Fluxos de conversa: ${flows.map((f) => `${f.name} (${f.status})`).join(', ')}.`)

  const text = lines.join('\n')
  cache.set(ctx.accountId, { at: Date.now(), text })
  return text
}
