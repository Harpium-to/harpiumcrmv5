import type { SupabaseClient } from '@supabase/supabase-js'

import type { JsonSchema, ToolSpec } from '@/lib/ai/tool-chat'
import { channelOf, sendChannelText } from '@/lib/channels/send-text'
import { resolveWhatsAppProvider } from '@/lib/channels/whatsapp-route'
import { contactOptedOut } from '@/lib/contacts/opt-out'
import { loadContactProfile, renderContactProfile } from '@/lib/contacts/profile'
import { transferirConversa } from '@/lib/atendimento/transferir'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'

import type { ActionKind } from './autonomy'
import { outsideServiceWindow, proactiveLimitReached } from './limites'
import { recallMemory, rememberFact, type MemoryKind } from './memory'
import { enqueueTask } from './tasks'
import type { Agent, AgentTask } from './types'

// ============================================================
// What an agent can do while it works a task on its own.
//
// The agent version of Harpi's tools (src/lib/assistente/tools), with
// two differences that come from who is acting:
//   - scope: everything is about the task's own contact. An agent
//     following up with Ana cannot browse the rest of the CRM;
//   - the brake: every tool that changes something names the action it
//     is (`action`), and `decide()` in autonomy.ts — the operator's
//     configuration, in code — says whether it runs, waits for a
//     person in Aprovações, or is not allowed at all. The model is
//     never asked.
//
// Reads, memory and "call a person" are never gated: they change
// nothing a customer sees, and calling a person is the safe way out.
// ============================================================

export interface AgentToolCtx {
  /** Service role: the runner acts for the CRM, not for a person. */
  db: SupabaseClient
  accountId: string
  agent: Agent
  task: AgentTask
  now: Date
  /** This task already sent its one message (see enviar_mensagem). */
  alreadySent: boolean
}

/** What a tool hands back to the model, and what it changed. */
export interface ToolOutcome {
  content: string
  isError?: boolean
  /** A message reached the customer. */
  sent?: boolean
}

/** What an approval card shows; built from the exact input. */
export interface ToolPreview {
  summary: string
  details: string[]
  /** The message, for enviar_mensagem: editable on the card. */
  text?: string
}

export interface AgentToolDef {
  name: string
  description: string
  parameters: JsonSchema
  /** null: never gated. Otherwise the action `decide()` judges. */
  action: ActionKind | null
  /** For gated tools: what the approval card shows, or why it can't run. */
  preview?: (ctx: AgentToolCtx, input: Record<string, unknown>) => Promise<ToolPreview | { error: string }>
  run: (ctx: AgentToolCtx, input: Record<string, unknown>) => Promise<ToolOutcome>
}

/** Thrown for a problem the model should read and work around. */
export class AgentToolError extends Error {}

type Row = Record<string, unknown>

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function json(value: unknown): string {
  return JSON.stringify(value, null, 1).slice(0, 6000)
}

function fail(message: string): ToolOutcome {
  return { content: message, isError: true }
}

function requireContact(ctx: AgentToolCtx): string {
  if (!ctx.task.contactId) {
    throw new AgentToolError('Esta tarefa não é sobre um contato, então não há cliente para isso.')
  }
  return ctx.task.contactId
}

/** The task's conversation, else the contact's latest. Never creates one. */
async function currentConversationId(ctx: AgentToolCtx): Promise<string | null> {
  if (ctx.task.conversationId) return ctx.task.conversationId
  if (!ctx.task.contactId) return null
  const { data } = await ctx.db
    .from('conversations')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('contact_id', ctx.task.contactId)
    .order('updated_at', { ascending: false })
    .limit(1)
  return ((data ?? []) as Row[])[0]?.id as string | undefined ?? null
}

async function lastCustomerMessageAt(ctx: AgentToolCtx, conversationId: string): Promise<string | null> {
  const { data } = await ctx.db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
  return (((data ?? []) as Row[])[0]?.created_at as string | undefined) ?? null
}

/** Who records rows that need a person (notes, tasks): the agent's handoff person, else the owner. */
async function standInUserId(ctx: AgentToolCtx): Promise<string | null> {
  if (ctx.agent.handoffAgentId) return ctx.agent.handoffAgentId
  const { data } = await ctx.db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', ctx.accountId)
    .maybeSingle()
  return ((data as Row | null)?.owner_user_id as string | undefined) ?? null
}

function isRonda(task: AgentTask): boolean {
  return task.kind === 'ronda' || typeof task.input?.ronda_id === 'string'
}

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

const verCliente: AgentToolDef = {
  name: 'ver_cliente',
  description:
    'Mostra o cliente desta tarefa como o CRM conhece: cadastro, respostas de formulário, negócios abertos (com id e etapa), próximos compromissos e tarefas abertas. Use antes de escrever.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  action: null,
  async run(ctx) {
    const contactId = requireContact(ctx)
    const profile = renderContactProfile(await loadContactProfile(ctx.db, ctx.accountId, contactId))
    const [deals, events, tasks] = await Promise.all([
      ctx.db
        .from('deals')
        .select('id, title, value, status, updated_at, stage:pipeline_stages(name)')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .order('updated_at', { ascending: false })
        .limit(5),
      ctx.db
        .from('calendar_events')
        .select('title, starts_at, status')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .gte('starts_at', ctx.now.toISOString())
        .in('status', ['pending', 'scheduled', 'confirmed'])
        .order('starts_at', { ascending: true })
        .limit(3),
      ctx.db
        .from('contact_tasks')
        .select('title, due_at')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .is('done_at', null)
        .limit(5),
    ])
    return {
      content: json({
        cadastro: profile ?? 'sem dados além do nome',
        negocios_abertos: ((deals.data ?? []) as Row[]).map((d) => ({
          id: d.id,
          titulo: d.title,
          etapa: (d.stage as Row | null)?.name ?? null,
          valor: d.value,
          atualizado_em: d.updated_at,
        })),
        proximos_compromissos: events.data ?? [],
        tarefas_abertas: tasks.error ? [] : (tasks.data ?? []),
      }),
    }
  },
}

const lerConversa: AgentToolDef = {
  name: 'ler_conversa',
  description:
    'Lê as últimas mensagens com este cliente (quem falou, quando e o quê) e diz se a janela de 24 horas da API oficial está aberta.',
  parameters: {
    type: 'object',
    properties: { limite: { type: 'integer', minimum: 5, maximum: 40, description: 'Quantas mensagens (padrão 20).' } },
    additionalProperties: false,
  },
  action: null,
  async run(ctx, input) {
    requireContact(ctx)
    const conversationId = await currentConversationId(ctx)
    if (!conversationId) return { content: 'Ainda não há conversa com este cliente.' }
    const limit = Math.min(Math.max(Number(input.limite) || 20, 5), 40)
    const { data } = await ctx.db
      .from('messages')
      .select('sender_type, content_text, content_type, created_at, ai_generated')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)
    const rows = ((data ?? []) as Row[]).reverse()
    const lastCustomer = await lastCustomerMessageAt(ctx, conversationId)
    return {
      content: json({
        janela_24h_aberta: !outsideServiceWindow(lastCustomer, ctx.now),
        ultima_mensagem_do_cliente: lastCustomer,
        mensagens: rows.map((m) => ({
          quem: m.sender_type === 'customer' ? 'cliente' : m.ai_generated ? 'ia' : 'empresa',
          quando: m.created_at,
          texto: str(m.content_text, 600) || `[${String(m.content_type ?? 'mídia')}]`,
        })),
      }),
    }
  },
}

const buscarMemoria: AgentToolDef = {
  name: 'buscar_memoria',
  description: 'Procura no que a equipe de agentes já guardou sobre este cliente e sobre a operação.',
  parameters: {
    type: 'object',
    properties: { busca: { type: 'string', description: 'O assunto, em poucas palavras.' } },
    required: ['busca'],
    additionalProperties: false,
  },
  action: null,
  async run(ctx, input) {
    const found = await recallMemory(ctx.db, {
      accountId: ctx.accountId,
      agentId: ctx.agent.id,
      contactId: ctx.task.contactId,
      query: str(input.busca, 300),
      limit: 8,
    })
    return { content: found.length > 0 ? json(found) : 'Nada guardado sobre isso.' }
  },
}

const MEMORY_KINDS: Record<string, MemoryKind> = {
  fato: 'fact',
  objecao: 'objection',
  preferencia: 'preference',
  resultado: 'outcome',
}

const guardarMemoria: AgentToolDef = {
  name: 'guardar_memoria',
  description:
    'Guarda algo que vale lembrar nas próximas conversas: uma preferência, uma objeção, um prazo, quem decide. Uma frase curta. Nunca guarde documento, cartão, senha ou dado de saúde.',
  parameters: {
    type: 'object',
    properties: {
      fato: { type: 'string', maxLength: 300 },
      tipo: { type: 'string', enum: Object.keys(MEMORY_KINDS) },
    },
    required: ['fato'],
    additionalProperties: false,
  },
  action: null,
  async run(ctx, input) {
    const content = str(input.fato, 300)
    if (!content) return fail('Diga o que guardar.')
    await rememberFact(ctx.db, {
      accountId: ctx.accountId,
      agentId: ctx.agent.id,
      contactId: ctx.task.contactId,
      scope: ctx.task.contactId ? 'contact' : 'team',
      kind: MEMORY_KINDS[str(input.tipo)] ?? 'fact',
      content,
    })
    return { content: 'Guardado.' }
  },
}

// ------------------------------------------------------------
// The way out: a person
// ------------------------------------------------------------

const chamarPessoa: AgentToolDef = {
  name: 'chamar_pessoa',
  description:
    'Passa o caso para uma pessoa da equipe, com o motivo. Use quando o cliente pedir alguém, reclamar, negociar preço ou condição, ou quando você não souber o que fazer. A IA para de responder essa conversa.',
  parameters: {
    type: 'object',
    properties: { motivo: { type: 'string', maxLength: 400 } },
    required: ['motivo'],
    additionalProperties: false,
  },
  action: null,
  async run(ctx, input) {
    const motivo = str(input.motivo, 400) || 'O agente pediu ajuda.'
    const conversationId = await currentConversationId(ctx)
    if (conversationId) {
      const result = await transferirConversa(ctx.db, {
        conversationId,
        target: ctx.agent.handoffAgentId
          ? { kind: 'pessoa', userId: ctx.agent.handoffAgentId }
          : { kind: 'ninguem' },
        source: 'ia',
        note: `${ctx.agent.name}: ${motivo}`,
        waiting: true,
      })
      return {
        content: result.ok
          ? 'Pronto: a conversa está com a equipe e a IA parou de responder nela.'
          : `A conversa foi para a fila da equipe (${result.reason ?? 'sem ninguém disponível agora'}).`,
      }
    }
    // No conversation yet: leave a task for a person instead.
    const userId = await standInUserId(ctx)
    if (!userId || !ctx.task.contactId) return fail('Não há conversa nem responsável para avisar.')
    const { error } = await ctx.db.from('contact_tasks').insert({
      account_id: ctx.accountId,
      contact_id: ctx.task.contactId,
      title: `Atender: ${motivo}`.slice(0, 200),
      created_by: userId,
      assigned_to: userId,
    })
    if (error) return fail(`Não consegui avisar a equipe: ${error.message}`)
    return { content: 'Pronto: ficou uma tarefa para a equipe atender este cliente.' }
  },
}

// ------------------------------------------------------------
// Gated: what the customer sees
// ------------------------------------------------------------

/** Why this message cannot go out now, or null. Checked at preview and again at send. */
async function sendBlocker(ctx: AgentToolCtx, text: string): Promise<string | null> {
  if (!text) return 'A mensagem está vazia.'
  if (ctx.alreadySent) return 'Esta tarefa já mandou uma mensagem. Uma por tarefa: agende um retorno se precisar falar de novo.'
  const contactId = requireContact(ctx)
  if (await contactOptedOut(ctx.db, ctx.accountId, contactId)) {
    return 'O cliente pediu para não receber mensagens automáticas. Não escreva; se for preciso, chame uma pessoa.'
  }
  const conversationId = await currentConversationId(ctx)
  if (conversationId) {
    const channel = await channelOf(conversationId, ctx.db)
    const official =
      channel === 'instagram' || (await resolveWhatsAppProvider(ctx.db, ctx.accountId)) === 'meta'
    if (official && outsideServiceWindow(await lastCustomerMessageAt(ctx, conversationId), ctx.now)) {
      return 'Fora da janela de 24 horas: a API oficial só aceita modelo aprovado, não texto livre. Não mande; chame uma pessoa ou agende um retorno.'
    }
  }
  if (isRonda(ctx.task)) {
    const { data } = await ctx.db
      .from('agent_proactive_sends')
      .select('sent_at')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .gte('sent_at', new Date(ctx.now.getTime() - 7 * 86_400_000).toISOString())
    const limit = proactiveLimitReached(((data ?? []) as Row[]).map((r) => String(r.sent_at)), ctx.now)
    if (limit === 'dia') return 'Este cliente já recebeu uma mensagem por iniciativa de um agente nas últimas 24 horas.'
    if (limit === 'semana') return 'Este cliente já recebeu 3 mensagens por iniciativa dos agentes nesta semana.'
  }
  return null
}

const enviarMensagem: AgentToolDef = {
  name: 'enviar_mensagem',
  description:
    'Manda uma mensagem ao cliente desta tarefa, no canal da conversa. Curta, natural, uma só por tarefa. Pode ficar esperando o OK de uma pessoa antes de sair.',
  parameters: {
    type: 'object',
    properties: { texto: { type: 'string', maxLength: 1500 } },
    required: ['texto'],
    additionalProperties: false,
  },
  action: 'send_message',
  async preview(ctx, input) {
    const text = str(input.texto, 1500)
    const blocked = await sendBlocker(ctx, text)
    if (blocked) return { error: blocked }
    return { summary: ctx.task.title, details: [], text }
  },
  async run(ctx, input) {
    const text = str(input.texto, 1500)
    const blocked = await sendBlocker(ctx, text)
    if (blocked) return fail(blocked)
    const contactId = requireContact(ctx)

    let conversationId = await currentConversationId(ctx)
    const { data: owner } = await ctx.db
      .from('whatsapp_config')
      .select('user_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    const userId = ((owner as Row | null)?.user_id as string | undefined) ?? (await standInUserId(ctx))
    if (!userId) return fail('O CRM não tem um responsável para registrar o envio.')
    if (!conversationId) {
      const { data: contact } = await ctx.db
        .from('contacts')
        .select('phone, name')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      const phone = (contact as Row | null)?.phone as string | undefined
      if (!phone) return fail('O cliente não tem telefone nem conversa para receber a mensagem.')
      try {
        conversationId = (await resolveConversationByPhone(ctx.db, ctx.accountId, phone, (contact as Row).name as string | null)).conversationId
      } catch {
        return fail('Não consegui abrir uma conversa com o telefone do cliente.')
      }
    }

    await sendChannelText({
      accountId: ctx.accountId,
      userId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
    if (isRonda(ctx.task)) {
      await ctx.db.from('agent_proactive_sends').insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        agent_id: ctx.agent.id,
        ronda_id: typeof ctx.task.input?.ronda_id === 'string' ? ctx.task.input.ronda_id : null,
        task_id: ctx.task.id,
      })
    }
    await rememberFact(ctx.db, {
      accountId: ctx.accountId,
      agentId: ctx.agent.id,
      contactId,
      scope: 'contact',
      kind: 'outcome',
      content: `${ctx.agent.name} enviou: ${text.slice(0, 300)}`,
    })
    return { content: 'Mensagem enviada.', sent: true }
  },
}

// ------------------------------------------------------------
// Gated: the CRM record
// ------------------------------------------------------------

const TEMPERATURES: Record<string, string> = { frio: 'cold', morno: 'warm', quente: 'hot' }

const atualizarCliente: AgentToolDef = {
  name: 'atualizar_cliente',
  description: 'Atualiza a temperatura (frio, morno, quente) e/ou o potencial (0 a 100) do cliente.',
  parameters: {
    type: 'object',
    properties: {
      temperatura: { type: 'string', enum: Object.keys(TEMPERATURES) },
      potencial: { type: 'integer', minimum: 0, maximum: 100 },
    },
    additionalProperties: false,
  },
  action: 'update_crm',
  async preview(ctx, input) {
    requireContact(ctx)
    const details: string[] = []
    if (TEMPERATURES[str(input.temperatura)]) details.push(`Temperatura: ${str(input.temperatura)}`)
    if (Number.isFinite(Number(input.potencial)) && input.potencial !== undefined) details.push(`Potencial: ${Number(input.potencial)}`)
    if (details.length === 0) return { error: 'Diga a temperatura ou o potencial.' }
    return { summary: `Atualizar o cliente — ${ctx.task.title}`, details }
  },
  async run(ctx, input) {
    const contactId = requireContact(ctx)
    const update: Row = {}
    const temp = TEMPERATURES[str(input.temperatura)]
    if (temp) update.temperature = temp
    const pot = Number(input.potencial)
    if (input.potencial !== undefined && Number.isFinite(pot)) update.potential = Math.min(100, Math.max(0, Math.round(pot)))
    if (Object.keys(update).length === 0) return fail('Nada para atualizar.')
    const { error } = await ctx.db.from('contacts').update(update).eq('id', contactId).eq('account_id', ctx.accountId)
    if (error) return fail(`Não consegui atualizar: ${error.message}`)
    return { content: 'Cliente atualizado.' }
  },
}

const anotar: AgentToolDef = {
  name: 'anotar',
  description: 'Deixa uma nota no contato, para a equipe ler (o que aconteceu, o que o cliente disse de importante).',
  parameters: {
    type: 'object',
    properties: { texto: { type: 'string', maxLength: 1000 } },
    required: ['texto'],
    additionalProperties: false,
  },
  action: 'log_activity',
  async preview(ctx, input) {
    requireContact(ctx)
    const text = str(input.texto, 1000)
    if (!text) return { error: 'A nota está vazia.' }
    return { summary: `Nota no contato — ${ctx.task.title}`, details: [text] }
  },
  async run(ctx, input) {
    const contactId = requireContact(ctx)
    const userId = await standInUserId(ctx)
    if (!userId) return fail('O CRM não tem um responsável para assinar a nota.')
    const { error } = await ctx.db.from('contact_notes').insert({
      account_id: ctx.accountId,
      contact_id: contactId,
      user_id: userId,
      note_text: `[${ctx.agent.name}] ${str(input.texto, 1000)}`,
    })
    if (error) return fail(`Não consegui salvar a nota: ${error.message}`)
    return { content: 'Nota salva.' }
  },
}

async function loadDealAndStage(ctx: AgentToolCtx, input: Record<string, unknown>) {
  const contactId = requireContact(ctx)
  const { data: deal } = await ctx.db
    .from('deals')
    .select('id, title, pipeline_id, stage_id, contact_id, stage:pipeline_stages(name)')
    .eq('id', str(input.negocio_id, 64))
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  const d = deal as Row | null
  if (!d || d.contact_id !== contactId) throw new AgentToolError('Negócio não encontrado para este cliente. Use ver_cliente para ver os ids.')
  const { data: stages } = await ctx.db
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', d.pipeline_id as string)
  const wanted = str(input.etapa, 100).toLowerCase()
  const stage = ((stages ?? []) as Row[]).find((s) => String(s.name).trim().toLowerCase() === wanted)
  if (!stage) {
    throw new AgentToolError(
      `Etapa não encontrada. As etapas deste funil são: ${((stages ?? []) as Row[]).map((s) => s.name).join(', ')}.`,
    )
  }
  if (stage.id === d.stage_id) throw new AgentToolError('O negócio já está nessa etapa.')
  return { deal: d, stage }
}

const moverNegocio: AgentToolDef = {
  name: 'mover_negocio',
  description: 'Muda um negócio deste cliente de etapa no funil. Use o id que ver_cliente mostra e o nome exato da etapa.',
  parameters: {
    type: 'object',
    properties: { negocio_id: { type: 'string' }, etapa: { type: 'string' } },
    required: ['negocio_id', 'etapa'],
    additionalProperties: false,
  },
  action: 'move_stage',
  async preview(ctx, input) {
    try {
      const { deal, stage } = await loadDealAndStage(ctx, input)
      return {
        summary: `Mover "${String(deal.title)}"`,
        details: [`${(deal.stage as Row | null)?.name ?? '?'} → ${String(stage.name)}`],
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'erro' }
    }
  },
  async run(ctx, input) {
    const { deal, stage } = await loadDealAndStage(ctx, input)
    const { error } = await ctx.db
      .from('deals')
      .update({ stage_id: stage.id })
      .eq('id', deal.id as string)
      .eq('account_id', ctx.accountId)
    if (error) return fail(`Não consegui mover: ${error.message}`)
    return { content: `Negócio movido para ${String(stage.name)}.` }
  },
}

/** "2026-12-01T14:00" or anything Date parses, bounded to a sane future. */
function parseWhen(value: unknown, now: Date): Date | null {
  const d = new Date(str(value, 40))
  if (!Number.isFinite(d.getTime())) return null
  const delta = d.getTime() - now.getTime()
  if (delta < 10 * 60_000 || delta > 60 * 86_400_000) return null
  return d
}

const criarTarefa: AgentToolDef = {
  name: 'criar_tarefa',
  description: 'Cria uma tarefa para a equipe sobre este cliente (por exemplo, "ligar para confirmar a medição"), com prazo opcional.',
  parameters: {
    type: 'object',
    properties: {
      titulo: { type: 'string', maxLength: 200 },
      prazo: { type: 'string', description: 'Data e hora ISO 8601, opcional.' },
    },
    required: ['titulo'],
    additionalProperties: false,
  },
  action: 'log_activity',
  async preview(ctx, input) {
    requireContact(ctx)
    const title = str(input.titulo, 200)
    if (!title) return { error: 'Dê um título à tarefa.' }
    const due = input.prazo ? parseWhen(input.prazo, ctx.now) : null
    return { summary: `Tarefa para a equipe: ${title}`, details: [due ? `Prazo: ${due.toISOString()}` : 'Sem prazo'] }
  },
  async run(ctx, input) {
    const contactId = requireContact(ctx)
    const userId = await standInUserId(ctx)
    if (!userId) return fail('O CRM não tem um responsável para receber a tarefa.')
    const due = input.prazo ? parseWhen(input.prazo, ctx.now) : null
    const { error } = await ctx.db.from('contact_tasks').insert({
      account_id: ctx.accountId,
      contact_id: contactId,
      title: `${str(input.titulo, 190)}`,
      due_at: due?.toISOString() ?? null,
      created_by: userId,
      assigned_to: userId,
    })
    if (error) return fail(`Não consegui criar a tarefa: ${error.message}`)
    return { content: 'Tarefa criada para a equipe.' }
  },
}

const agendarRetorno: AgentToolDef = {
  name: 'agendar_retorno',
  description:
    'Agenda você mesmo voltar a este cliente numa data (por exemplo, "o cliente pediu para chamar quinta às 10h"). Entre 10 minutos e 60 dias a partir de agora, em ISO 8601 com fuso.',
  parameters: {
    type: 'object',
    properties: {
      quando: { type: 'string', description: 'Data e hora ISO 8601, com fuso (ex.: 2026-12-03T10:00:00-03:00).' },
      motivo: { type: 'string', maxLength: 300 },
    },
    required: ['quando', 'motivo'],
    additionalProperties: false,
  },
  action: 'update_crm',
  async preview(ctx, input) {
    requireContact(ctx)
    const when = parseWhen(input.quando, ctx.now)
    if (!when) return { error: 'Data inválida: use ISO 8601, entre 10 minutos e 60 dias a partir de agora.' }
    return {
      summary: `Retomar o cliente — ${ctx.task.title}`,
      details: [`Quando: ${when.toISOString()}`, `Motivo: ${str(input.motivo, 300)}`],
    }
  },
  async run(ctx, input) {
    const contactId = requireContact(ctx)
    const when = parseWhen(input.quando, ctx.now)
    if (!when) return fail('Data inválida: use ISO 8601, entre 10 minutos e 60 dias a partir de agora.')
    const motivo = str(input.motivo, 300)
    const task = await enqueueTask(ctx.db, {
      accountId: ctx.accountId,
      agentId: ctx.agent.id,
      createdByAgentId: ctx.agent.id,
      kind: 'followup',
      title: `Retorno: ${motivo || ctx.task.title}`.slice(0, 200),
      input: { motivo, origem: ctx.task.title, tarefa_anterior: ctx.task.id },
      contactId,
      conversationId: ctx.task.conversationId,
      dealId: ctx.task.dealId,
      scheduledFor: when,
      dedupeKey: `retorno:${ctx.task.id}`,
    })
    return { content: task ? `Retorno agendado para ${when.toISOString()}.` : 'Já havia um retorno agendado por esta tarefa.' }
  },
}

export const AGENT_TOOLS: AgentToolDef[] = [
  verCliente,
  lerConversa,
  buscarMemoria,
  guardarMemoria,
  chamarPessoa,
  enviarMensagem,
  atualizarCliente,
  anotar,
  moverNegocio,
  criarTarefa,
  agendarRetorno,
]

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]))

export function agentToolByName(name: string): AgentToolDef | undefined {
  return BY_NAME.get(name)
}

export function toToolSpec(tool: AgentToolDef): ToolSpec {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}
