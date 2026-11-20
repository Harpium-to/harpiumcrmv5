import { findExistingContact } from '@/lib/contacts/dedupe'
import { transferirConversa, type TransferTarget } from '@/lib/atendimento/transferir'
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags'
import { findOrCreateContact, parseContactPatch } from '@/lib/api/v1/contacts'
import { parseDealCreate, resolveDealPlacement } from '@/lib/api/v1/deals'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

import { LINKS, TEMPERATURE_LABEL, clip, dateTime, money } from '../format'
import { parseLocalDateTime } from '../time'
import { ToolError, type Prepared, type ToolContext, type ToolDef } from '../types'

// ============================================================
// Phase 2 — changes to the CRM's records, each behind a card.
//
// `prepare` reads what is there and builds the card from the exact
// input; `execute` writes through the person's own RLS client (the
// same writes their screens make) and returns what `undo` needs to
// put it back. Batches are capped: 200 records per card.
// ============================================================

type Row = Record<string, unknown>

export const BATCH_MAX = 200

const UUID = { type: 'string', format: 'uuid' } as const

async function loadContact(ctx: ToolContext, id: string): Promise<Row> {
  const { data, error } = await ctx.db
    .from('contacts')
    .select('id, name, phone, email, company, city, job_title, temperature, potential, segment, source, instagram, website')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (error) throw new ToolError(`Não consegui ler o contato: ${error.message}`)
  if (!data) throw new ToolError('Contato não encontrado neste CRM.')
  return data as Row
}

function contactLabel(row: Row): string {
  return String(row.name || row.phone || 'contato')
}

async function accountCurrency(ctx: ToolContext): Promise<string> {
  const { data } = await ctx.db
    .from('accounts')
    .select('default_currency')
    .eq('id', ctx.accountId)
    .maybeSingle()
  return ((data as Row | null)?.default_currency as string | undefined) ?? 'BRL'
}

// ------------------------------------------------------------
// Contacts
// ------------------------------------------------------------

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  company: 'Empresa',
  city: 'Cidade',
  job_title: 'Cargo',
  segment: 'Segmento',
  source: 'Origem',
  instagram: 'Instagram',
  website: 'Site',
  temperature: 'Temperatura',
  potential: 'Potencial',
}

const PT_TO_COLUMN: Record<string, string> = {
  nome: 'name',
  email: 'email',
  empresa: 'company',
  cidade: 'city',
  cargo: 'job_title',
  segmento: 'segment',
  origem: 'source',
  instagram: 'instagram',
  site: 'website',
  temperatura: 'temperature',
  potencial: 'potential',
}

function showValue(column: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vazio)'
  if (column === 'temperature') return TEMPERATURE_LABEL[String(value)] ?? String(value)
  return clip(String(value), 60)
}

const criarContato: ToolDef = {
  name: 'criar_contato',
  label: 'Preparou um contato novo',
  risk: 'pequena',
  minRole: 'agent',
  description: 'Cria um contato. O telefone vai no formato internacional (+55…). Se o telefone já existir, avisa em vez de duplicar.',
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      telefone: { type: 'string', minLength: 8, maxLength: 20, description: 'Ex.: +5563999998888' },
      email: { type: 'string', maxLength: 160 },
      empresa: { type: 'string', maxLength: 120 },
      temperatura: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      etiquetas: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 60 }, maxItems: 10 },
    },
    required: ['nome', 'telefone'],
  },
  async prepare(ctx, input) {
    const phone = sanitizePhoneForMeta(String(input.telefone))
    if (!isValidE164(phone)) return { error: 'telefone inválido; use o formato +55DDDNÚMERO' }
    const existing = await findExistingContact(ctx.db, ctx.accountId, phone)
    if (existing) {
      return { error: `já existe um contato com esse telefone (id ${existing.id}); use editar_contato ou alterar_contatos` }
    }
    const lines = [`Nome: ${input.nome}`, `Telefone: ${phone}`]
    if (input.email) lines.push(`E-mail: ${input.email}`)
    if (input.empresa) lines.push(`Empresa: ${input.empresa}`)
    if (input.temperatura) lines.push(`Temperatura: ${TEMPERATURE_LABEL[String(input.temperatura)]}`)
    const tags = (input.etiquetas as string[] | undefined) ?? []
    if (tags.length) lines.push(`Etiquetas: ${tags.join(', ')}`)
    return { preview: { title: `Criar contato: ${input.nome}`, lines }, input: { ...input, telefone: phone } }
  },
  async execute(ctx, input) {
    const created = await findOrCreateContact(ctx.db, ctx.accountId, ctx.userId, {
      phone: String(input.telefone),
      name: String(input.nome),
      email: (input.email as string) ?? null,
      company: (input.empresa as string) ?? null,
    })
    if (input.temperatura) {
      await ctx.db.from('contacts').update({ temperature: input.temperatura }).eq('id', created.id)
    }
    const tags = (input.etiquetas as string[] | undefined) ?? []
    if (tags.length) await addTags(ctx, [created.id], tags)
    return {
      summary: created.created ? `Contato ${input.nome} criado.` : `O contato já existia; não criei outro.`,
      link: { href: LINKS.contact(created.id), label: 'Abrir contato' },
      result: { contato_id: created.id },
      undo: created.created ? { contact_id: created.id } : undefined,
    }
  },
  async undo(ctx, data) {
    const { error } = await ctx.db
      .from('contacts')
      .delete()
      .eq('id', String(data.contact_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui apagar o contato: ${error.message}`)
  },
}

const editarContato: ToolDef = {
  name: 'editar_contato',
  label: 'Preparou uma alteração de contato',
  risk: 'pequena',
  minRole: 'agent',
  description:
    'Muda dados de UM contato: nome, email, empresa, cidade, cargo, segmento, origem, instagram, site, temperatura (cold/warm/hot) e potencial (0–100).',
  parameters: {
    type: 'object',
    properties: {
      contato_id: UUID,
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      email: { type: 'string', maxLength: 160 },
      empresa: { type: 'string', maxLength: 120 },
      cidade: { type: 'string', maxLength: 80 },
      cargo: { type: 'string', maxLength: 80 },
      segmento: { type: 'string', maxLength: 80 },
      origem: { type: 'string', maxLength: 80 },
      instagram: { type: 'string', maxLength: 80 },
      site: { type: 'string', maxLength: 160 },
      temperatura: { type: 'string', enum: ['cold', 'warm', 'hot'] },
      potencial: { type: 'integer', minimum: 0, maximum: 100 },
    },
    required: ['contato_id'],
  },
  async prepare(ctx, input) {
    const current = await loadContact(ctx, String(input.contato_id))
    const body: Row = {}
    for (const [pt, column] of Object.entries(PT_TO_COLUMN)) {
      if (input[pt] !== undefined) body[column] = input[pt]
    }
    const patch = parseContactPatch(body)
    if (!patch.ok) return { error: patch.message }
    const changes = Object.entries(patch.updates).filter(
      ([column, value]) => (current[column] ?? null) !== (value ?? null),
    )
    if (changes.length === 0) return { error: 'nada a mudar: o contato já está assim' }
    return {
      preview: {
        title: `Alterar contato: ${contactLabel(current)}`,
        lines: changes.map(
          ([column, value]) => `${FIELD_LABEL[column] ?? column}: ${showValue(column, current[column])} → ${showValue(column, value)}`,
        ),
      },
      input: { contato_id: current.id, updates: Object.fromEntries(changes) },
    }
  },
  async execute(ctx, input) {
    const updates = (input.updates ?? {}) as Row
    const before = await loadContact(ctx, String(input.contato_id))
    const { error } = await ctx.db
      .from('contacts')
      .update(updates)
      .eq('id', String(input.contato_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui alterar o contato: ${error.message}`)
    return {
      summary: `Contato ${contactLabel(before)} alterado.`,
      link: { href: LINKS.contact(String(input.contato_id)), label: 'Abrir contato' },
      undo: {
        contact_id: input.contato_id,
        previous: Object.fromEntries(Object.keys(updates).map((k) => [k, before[k] ?? null])),
      },
    }
  },
  async undo(ctx, data) {
    const { error } = await ctx.db
      .from('contacts')
      .update(data.previous as Row)
      .eq('id', String(data.contact_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui desfazer: ${error.message}`)
  },
}

/** Tags by name → id, creating the missing ones. */
async function tagIds(ctx: ToolContext, names: string[], create: boolean): Promise<Map<string, string>> {
  const { tagIdByKey } = await resolveImportTagIds(ctx.db, {
    accountId: ctx.accountId,
    userId: ctx.userId,
    tagNames: names,
    canCreateTags: create,
  })
  return tagIdByKey
}

/** Adds tags; returns the pairs it actually added (for undo). */
async function addTags(ctx: ToolContext, contactIds: string[], names: string[]): Promise<[string, string][]> {
  const ids = [...new Set((await tagIds(ctx, names, true)).values())]
  if (ids.length === 0) return []
  const { data: existing } = await ctx.db
    .from('contact_tags')
    .select('contact_id, tag_id')
    .in('contact_id', contactIds)
    .in('tag_id', ids)
  const have = new Set(((existing ?? []) as Row[]).map((r) => `${r.contact_id}:${r.tag_id}`))
  const rows = contactIds.flatMap((c) =>
    ids.filter((t) => !have.has(`${c}:${t}`)).map((t) => ({ contact_id: c, tag_id: t })),
  )
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.db.from('contact_tags').insert(rows.slice(i, i + 500))
    if (error) throw new ToolError(`Não consegui pôr as etiquetas: ${error.message}`)
  }
  return rows.map((r) => [r.contact_id, r.tag_id])
}

async function removeTags(ctx: ToolContext, contactIds: string[], names: string[]): Promise<[string, string][]> {
  const ids = [...new Set((await tagIds(ctx, names, false)).values())]
  if (ids.length === 0) return []
  const { data: existing } = await ctx.db
    .from('contact_tags')
    .select('contact_id, tag_id')
    .in('contact_id', contactIds)
    .in('tag_id', ids)
  const pairs = ((existing ?? []) as Row[]).map((r) => [String(r.contact_id), String(r.tag_id)] as [string, string])
  if (pairs.length === 0) return []
  const { error } = await ctx.db.from('contact_tags').delete().in('contact_id', contactIds).in('tag_id', ids)
  if (error) throw new ToolError(`Não consegui tirar as etiquetas: ${error.message}`)
  return pairs
}

const alterarContatos: ToolDef = {
  name: 'alterar_contatos',
  label: 'Preparou uma alteração em contatos',
  risk: 'pequena',
  minRole: 'agent',
  description: `Põe ou tira etiquetas e/ou muda a temperatura de um ou vários contatos de uma vez (até ${BATCH_MAX}). Pegue os IDs com buscar_contatos antes. Etiqueta que não existe é criada ao adicionar.`,
  parameters: {
    type: 'object',
    properties: {
      contato_ids: { type: 'array', items: UUID, minItems: 1, maxItems: BATCH_MAX },
      adicionar_etiquetas: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 60 }, maxItems: 10 },
      remover_etiquetas: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 60 }, maxItems: 10 },
      temperatura: { type: 'string', enum: ['cold', 'warm', 'hot'] },
    },
    required: ['contato_ids'],
  },
  async prepare(ctx, input) {
    const ids = [...new Set(input.contato_ids as string[])]
    const add = (input.adicionar_etiquetas as string[] | undefined) ?? []
    const remove = (input.remover_etiquetas as string[] | undefined) ?? []
    if (!add.length && !remove.length && !input.temperatura) {
      return { error: 'diga o que mudar: adicionar_etiquetas, remover_etiquetas ou temperatura' }
    }
    const { data, error } = await ctx.db
      .from('contacts')
      .select('id, name, phone')
      .eq('account_id', ctx.accountId)
      .in('id', ids)
    if (error) return { error: `não consegui ler os contatos: ${error.message}` }
    const found = (data ?? []) as Row[]
    if (found.length === 0) return { error: 'nenhum desses contatos é deste CRM' }
    const lines: string[] = []
    if (add.length) lines.push(`Adicionar etiqueta(s): ${add.join(', ')}`)
    if (remove.length) lines.push(`Tirar etiqueta(s): ${remove.join(', ')}`)
    if (input.temperatura) lines.push(`Temperatura: ${TEMPERATURE_LABEL[String(input.temperatura)]}`)
    const warnings: string[] = []
    if (found.length < ids.length) warnings.push(`${ids.length - found.length} ID(s) não são deste CRM e ficam de fora.`)
    const many = found.length > 1
    return {
      preview: {
        title: many ? `Alterar ${found.length} contatos` : `Alterar contato: ${contactLabel(found[0])}`,
        lines,
        count: many ? found.length : undefined,
        sample: many ? found.slice(0, 8).map(contactLabel) : undefined,
        badges: many ? [`${found.length} contatos`] : undefined,
        warnings,
      },
      input: { ...input, contato_ids: found.map((r) => r.id) },
      risk: many ? 'maior' : 'pequena',
    }
  },
  async execute(ctx, input) {
    const ids = input.contato_ids as string[]
    const added = input.adicionar_etiquetas ? await addTags(ctx, ids, input.adicionar_etiquetas as string[]) : []
    const removed = input.remover_etiquetas ? await removeTags(ctx, ids, input.remover_etiquetas as string[]) : []
    let previousTemps: [string, string][] = []
    if (input.temperatura) {
      const { data } = await ctx.db.from('contacts').select('id, temperature').in('id', ids).eq('account_id', ctx.accountId)
      previousTemps = ((data ?? []) as Row[]).map((r) => [String(r.id), String(r.temperature ?? 'cold')])
      const { error } = await ctx.db
        .from('contacts')
        .update({ temperature: input.temperatura })
        .in('id', ids)
        .eq('account_id', ctx.accountId)
      if (error) throw new ToolError(`Não consegui mudar a temperatura: ${error.message}`)
    }
    return {
      summary: `${ids.length} contato(s) alterado(s).`,
      link: ids.length === 1 ? { href: LINKS.contact(ids[0]), label: 'Abrir contato' } : undefined,
      undo: { added, removed, previousTemps },
    }
  },
  async undo(ctx, data) {
    const added = (data.added ?? []) as [string, string][]
    const removed = (data.removed ?? []) as [string, string][]
    for (const [contactId, tagId] of added) {
      await ctx.db.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', tagId)
    }
    if (removed.length) {
      await ctx.db.from('contact_tags').insert(removed.map(([contact_id, tag_id]) => ({ contact_id, tag_id })))
    }
    const temps = (data.previousTemps ?? []) as [string, string][]
    const byTemp = new Map<string, string[]>()
    for (const [id, t] of temps) byTemp.set(t, [...(byTemp.get(t) ?? []), id])
    for (const [t, ids] of byTemp) {
      await ctx.db.from('contacts').update({ temperature: t }).in('id', ids).eq('account_id', ctx.accountId)
    }
  },
}

// ------------------------------------------------------------
// Notes and tasks
// ------------------------------------------------------------

const adicionarNota: ToolDef = {
  name: 'adicionar_nota',
  label: 'Preparou uma nota',
  risk: 'pequena',
  minRole: 'agent',
  description: 'Escreve uma nota interna no contato (só a equipe vê).',
  parameters: {
    type: 'object',
    properties: { contato_id: UUID, texto: { type: 'string', minLength: 1, maxLength: 4000 } },
    required: ['contato_id', 'texto'],
  },
  async prepare(ctx, input) {
    const c = await loadContact(ctx, String(input.contato_id))
    return {
      preview: { title: `Nota em ${contactLabel(c)}`, lines: [clip(String(input.texto), 400)] },
      input,
    }
  },
  async execute(ctx, input) {
    const { data, error } = await ctx.db
      .from('contact_notes')
      .insert({
        account_id: ctx.accountId,
        contact_id: input.contato_id,
        user_id: ctx.userId,
        note_text: String(input.texto),
      })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui salvar a nota: ${error?.message ?? ''}`)
    return {
      summary: 'Nota salva.',
      link: { href: LINKS.contact(String(input.contato_id)), label: 'Abrir contato' },
      undo: { note_id: (data as Row).id },
    }
  },
  async undo(ctx, data) {
    await ctx.db.from('contact_notes').delete().eq('id', String(data.note_id)).eq('account_id', ctx.accountId)
  },
}

const criarTarefa: ToolDef = {
  name: 'criar_tarefa',
  label: 'Preparou uma tarefa',
  risk: 'pequena',
  minRole: 'agent',
  description:
    'Cria uma tarefa ligada a um contato, com prazo opcional (AAAA-MM-DDTHH:MM no fuso da pessoa) e responsável (padrão: quem pede). O CRM avisa no prazo.',
  parameters: {
    type: 'object',
    properties: {
      contato_id: UUID,
      titulo: { type: 'string', minLength: 1, maxLength: 200 },
      vence_em: { type: 'string', description: 'AAAA-MM-DDTHH:MM' },
      responsavel_id: UUID,
    },
    required: ['contato_id', 'titulo'],
  },
  async prepare(ctx, input) {
    const c = await loadContact(ctx, String(input.contato_id))
    let due: string | null = null
    if (input.vence_em) {
      const d = parseLocalDateTime(String(input.vence_em), ctx.timezone)
      if (!d) return { error: 'vence_em precisa ser AAAA-MM-DDTHH:MM' }
      due = d.toISOString()
    }
    const lines = [`Tarefa: ${input.titulo}`, `Contato: ${contactLabel(c)}`]
    lines.push(`Prazo: ${due ? dateTime(due, ctx.timezone) : 'sem prazo'}`)
    lines.push(`Responsável: ${input.responsavel_id && input.responsavel_id !== ctx.userId ? 'outra pessoa da equipe' : 'você'}`)
    return {
      preview: { title: `Criar tarefa: ${clip(String(input.titulo), 60)}`, lines },
      input: { ...input, due_at: due },
    }
  },
  async execute(ctx, input) {
    const { data, error } = await ctx.db
      .from('contact_tasks')
      .insert({
        account_id: ctx.accountId,
        contact_id: input.contato_id,
        title: String(input.titulo),
        due_at: (input.due_at as string) ?? null,
        created_by: ctx.userId,
        assigned_to: (input.responsavel_id as string) ?? ctx.userId,
      })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui criar a tarefa: ${error?.message ?? ''}`)
    return {
      summary: 'Tarefa criada.',
      link: { href: LINKS.contact(String(input.contato_id)), label: 'Abrir contato' },
      undo: { task_id: (data as Row).id },
    }
  },
  async undo(ctx, data) {
    await ctx.db.from('contact_tasks').delete().eq('id', String(data.task_id)).eq('account_id', ctx.accountId)
  },
}

const concluirTarefa: ToolDef = {
  name: 'concluir_tarefa',
  label: 'Preparou a conclusão de uma tarefa',
  risk: 'pequena',
  minRole: 'agent',
  description: 'Marca uma tarefa como concluída.',
  parameters: { type: 'object', properties: { tarefa_id: UUID }, required: ['tarefa_id'] },
  async prepare(ctx, input) {
    const { data } = await ctx.db
      .from('contact_tasks')
      .select('id, title, done_at, contact:contacts(name)')
      .eq('id', String(input.tarefa_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!data) return { error: 'tarefa não encontrada neste CRM' }
    const t = data as Row
    if (t.done_at) return { error: 'essa tarefa já está concluída' }
    return {
      preview: {
        title: `Concluir tarefa: ${clip(String(t.title), 60)}`,
        lines: [`Contato: ${(t.contact as Row | null)?.name ?? '—'}`],
      },
      input,
    }
  },
  async execute(ctx, input) {
    const { error } = await ctx.db
      .from('contact_tasks')
      .update({ done_at: ctx.now.toISOString() })
      .eq('id', String(input.tarefa_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui concluir: ${error.message}`)
    return { summary: 'Tarefa concluída.', undo: { task_id: input.tarefa_id } }
  },
  async undo(ctx, data) {
    await ctx.db.from('contact_tasks').update({ done_at: null }).eq('id', String(data.task_id)).eq('account_id', ctx.accountId)
  },
}

// ------------------------------------------------------------
// Deals
// ------------------------------------------------------------

async function loadDeal(ctx: ToolContext, id: string): Promise<Row> {
  const { data, error } = await ctx.db
    .from('deals')
    .select('id, title, value, currency, status, pipeline_id, stage_id, stage:pipeline_stages(name), pipeline:pipelines(name), contact:contacts(name)')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (error) throw new ToolError(`Não consegui ler o negócio: ${error.message}`)
  if (!data) throw new ToolError('Negócio não encontrado neste CRM.')
  return data as Row
}

const criarNegocio: ToolDef = {
  name: 'criar_negocio',
  label: 'Preparou um negócio',
  risk: 'pequena',
  minRole: 'agent',
  description:
    'Abre um negócio para um contato. Sem funil/etapa, vai para a primeira etapa do primeiro funil. previsao = AAAA-MM-DD.',
  parameters: {
    type: 'object',
    properties: {
      contato_id: UUID,
      titulo: { type: 'string', minLength: 1, maxLength: 200 },
      valor: { type: 'number', minimum: 0 },
      funil_id: UUID,
      etapa_id: UUID,
      previsao: { type: 'string' },
      observacoes: { type: 'string', maxLength: 2000 },
    },
    required: ['contato_id', 'titulo'],
  },
  async prepare(ctx, input) {
    const c = await loadContact(ctx, String(input.contato_id))
    const parsed = parseDealCreate({
      contact_id: input.contato_id,
      title: input.titulo,
      ...(input.valor !== undefined ? { value: input.valor } : {}),
      ...(input.funil_id ? { pipeline_id: input.funil_id } : {}),
      ...(input.etapa_id ? { stage_id: input.etapa_id } : {}),
      ...(input.previsao ? { expected_close_date: input.previsao } : {}),
      ...(input.observacoes ? { notes: input.observacoes } : {}),
    })
    if (!parsed.ok) return { error: parsed.message }
    const placement = await resolveDealPlacement(
      ctx.db,
      ctx.accountId,
      parsed.values.pipeline_id,
      parsed.values.stage_id,
    )
    if (!placement.ok) return { error: placement.message }
    const [{ data: stage }, currency] = await Promise.all([
      ctx.db.from('pipeline_stages').select('name, pipeline:pipelines(name)').eq('id', placement.stage_id).maybeSingle(),
      accountCurrency(ctx),
    ])
    const s = stage as Row | null
    return {
      preview: {
        title: `Abrir negócio: ${clip(String(input.titulo), 60)}`,
        lines: [
          `Contato: ${contactLabel(c)}`,
          `Funil: ${(s?.pipeline as Row | null)?.name ?? '?'} › ${s?.name ?? '?'}`,
          `Valor: ${money(parsed.values.value, currency)}`,
          ...(parsed.values.expected_close_date ? [`Previsão: ${parsed.values.expected_close_date}`] : []),
        ],
      },
      input: { ...parsed.values, pipeline_id: placement.pipeline_id, stage_id: placement.stage_id, currency },
    }
  },
  async execute(ctx, input) {
    const { data, error } = await ctx.db
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        contact_id: input.contact_id,
        pipeline_id: input.pipeline_id,
        stage_id: input.stage_id,
        title: input.title,
        value: input.value ?? 0,
        currency: input.currency ?? 'BRL',
        notes: input.notes ?? null,
        expected_close_date: input.expected_close_date ?? null,
        status: 'open',
      })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui abrir o negócio: ${error?.message ?? ''}`)
    return {
      summary: `Negócio "${input.title}" aberto.`,
      link: { href: LINKS.pipelines(), label: 'Ver no funil' },
      result: { negocio_id: (data as Row).id },
      undo: { deal_id: (data as Row).id },
    }
  },
  async undo(ctx, data) {
    await ctx.db.from('deals').delete().eq('id', String(data.deal_id)).eq('account_id', ctx.accountId)
  },
}

const moverNegocio: ToolDef = {
  name: 'mover_negocio',
  label: 'Preparou a mudança de etapa',
  risk: 'pequena',
  minRole: 'agent',
  description: 'Move um negócio para outra etapa do MESMO funil.',
  parameters: {
    type: 'object',
    properties: { negocio_id: UUID, etapa_id: UUID },
    required: ['negocio_id', 'etapa_id'],
  },
  async prepare(ctx, input) {
    const deal = await loadDeal(ctx, String(input.negocio_id))
    const { data: stage } = await ctx.db
      .from('pipeline_stages')
      .select('id, name, pipeline_id')
      .eq('id', String(input.etapa_id))
      .maybeSingle()
    const s = stage as Row | null
    if (!s || s.pipeline_id !== deal.pipeline_id) return { error: 'essa etapa não é do funil desse negócio' }
    if (deal.stage_id === s.id) return { error: 'o negócio já está nessa etapa' }
    return {
      preview: {
        title: `Mover negócio: ${clip(String(deal.title), 60)}`,
        lines: [
          `${(deal.stage as Row | null)?.name ?? '?'} → ${s.name}`,
          `Contato: ${(deal.contact as Row | null)?.name ?? '—'}`,
        ],
      },
      input,
    }
  },
  async execute(ctx, input) {
    const deal = await loadDeal(ctx, String(input.negocio_id))
    const { error } = await ctx.db
      .from('deals')
      .update({ stage_id: input.etapa_id })
      .eq('id', String(input.negocio_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui mover: ${error.message}`)
    return {
      summary: `Negócio "${deal.title}" movido.`,
      link: { href: LINKS.pipelines(), label: 'Ver no funil' },
      undo: { deal_id: deal.id, stage_id: deal.stage_id },
    }
  },
  async undo(ctx, data) {
    await ctx.db
      .from('deals')
      .update({ stage_id: data.stage_id })
      .eq('id', String(data.deal_id))
      .eq('account_id', ctx.accountId)
  },
}

const encerrarNegocio: ToolDef = {
  name: 'encerrar_negocio',
  label: 'Preparou o fechamento de um negócio',
  risk: 'maior',
  minRole: 'agent',
  description: 'Marca um negócio como ganho ou perdido (entra nos relatórios de vendas).',
  parameters: {
    type: 'object',
    properties: {
      negocio_id: UUID,
      resultado: { type: 'string', enum: ['ganho', 'perdido'] },
    },
    required: ['negocio_id', 'resultado'],
  },
  async prepare(ctx, input) {
    const deal = await loadDeal(ctx, String(input.negocio_id))
    if (deal.status !== 'open') return { error: `esse negócio já está ${deal.status === 'won' ? 'ganho' : 'perdido'}` }
    const won = input.resultado === 'ganho'
    return {
      preview: {
        title: `${won ? 'Ganhar' : 'Perder'} negócio: ${clip(String(deal.title), 60)}`,
        lines: [
          `Valor: ${money(deal.value as number, (deal.currency as string) || 'BRL')}`,
          `Contato: ${(deal.contact as Row | null)?.name ?? '—'}`,
        ],
        badges: ['Entra nos relatórios'],
      },
      input,
    }
  },
  async execute(ctx, input) {
    const status = input.resultado === 'ganho' ? 'won' : 'lost'
    const { error } = await ctx.db
      .from('deals')
      .update({ status })
      .eq('id', String(input.negocio_id))
      .eq('account_id', ctx.accountId)
      .eq('status', 'open')
    if (error) throw new ToolError(`Não consegui fechar: ${error.message}`)
    return {
      summary: `Negócio marcado como ${input.resultado}.`,
      link: { href: LINKS.pipelines(), label: 'Ver no funil' },
      undo: { deal_id: input.negocio_id },
    }
  },
  async undo(ctx, data) {
    await ctx.db.from('deals').update({ status: 'open' }).eq('id', String(data.deal_id)).eq('account_id', ctx.accountId)
  },
}

// ------------------------------------------------------------
// Conversations
// ------------------------------------------------------------

async function loadConversation(ctx: ToolContext, id: string): Promise<Row> {
  const { data } = await ctx.db
    .from('conversations')
    .select('id, status, assigned_agent_id, contact:contacts(name)')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!data) throw new ToolError('Conversa não encontrada neste CRM.')
  return data as Row
}

const atribuirConversa: ToolDef = {
  name: 'atribuir_conversa',
  label: 'Preparou uma transferência',
  risk: 'pequena',
  minRole: 'agent',
  description:
    'Passa uma conversa para uma pessoa da equipe (ID de listar_equipe) ou para um setor (ID de listar_setores, que escolhe a pessoa pela regra dele), com uma nota opcional que quem recebe lê. Sem pessoa nem setor, devolve para a fila geral.',
  parameters: {
    type: 'object',
    properties: {
      conversa_id: UUID,
      pessoa_id: UUID,
      setor_id: UUID,
      nota: { type: 'string', description: 'Recado curto para quem recebe (até 500 caracteres).' },
    },
    required: ['conversa_id'],
  },
  async prepare(ctx, input) {
    const conv = await loadConversation(ctx, String(input.conversa_id))
    let who = 'ninguém (fila da equipe)'
    if (input.setor_id) {
      const { data: team } = await ctx.db
        .from('teams')
        .select('name')
        .eq('account_id', ctx.accountId)
        .eq('id', String(input.setor_id))
        .eq('active', true)
        .maybeSingle()
      if (!team) return { error: 'esse setor não existe neste CRM (veja listar_setores)' }
      who = `setor ${(team as Row).name as string} (a regra do setor escolhe a pessoa)`
    } else if (input.pessoa_id) {
      const { data } = await ctx.db
        .from('account_members')
        .select('user_id, role')
        .eq('account_id', ctx.accountId)
        .eq('user_id', String(input.pessoa_id))
        .maybeSingle()
      if (!data) return { error: 'essa pessoa não é da equipe deste CRM' }
      if ((data as Row).role === 'viewer') return { error: 'essa pessoa só tem acesso de leitura e não atende conversas' }
      const { data: p } = await ctx.admin.from('profiles').select('full_name').eq('user_id', String(input.pessoa_id)).maybeSingle()
      who = ((p as Row | null)?.full_name as string) || 'pessoa da equipe'
    }
    const nota = typeof input.nota === 'string' ? input.nota.trim().slice(0, 500) : ''
    return {
      preview: {
        title: `Transferir conversa de ${(conv.contact as Row | null)?.name ?? 'contato'}`,
        lines: [`Para: ${who}`, ...(nota ? [`Nota: ${nota}`] : [])],
      },
      input,
    }
  },
  async execute(ctx, input) {
    const conv = await loadConversation(ctx, String(input.conversa_id))
    const target: TransferTarget = input.setor_id
      ? { kind: 'setor', teamId: String(input.setor_id) }
      : input.pessoa_id
        ? { kind: 'pessoa', userId: String(input.pessoa_id) }
        : { kind: 'ninguem' }
    let result
    try {
      result = await transferirConversa(ctx.db, {
        conversationId: String(input.conversa_id),
        target,
        source: 'harpi',
        note: typeof input.nota === 'string' ? input.nota : null,
      })
    } catch (err) {
      throw new ToolError(`Não consegui transferir: ${err instanceof Error ? err.message : 'erro'}`)
    }
    if (!result.ok && result.reason === 'nobody_available') {
      return {
        summary: 'Ninguém do setor está disponível agora: a conversa ficou na fila do setor.',
        link: { href: LINKS.conversation(String(input.conversa_id)), label: 'Abrir conversa' },
        undo: { conversation_id: input.conversa_id, assigned: conv.assigned_agent_id ?? null },
      }
    }
    return {
      summary: 'Conversa transferida.',
      link: { href: LINKS.conversation(String(input.conversa_id)), label: 'Abrir conversa' },
      undo: { conversation_id: input.conversa_id, assigned: conv.assigned_agent_id ?? null },
    }
  },
  async undo(ctx, data) {
    const before = (data.assigned as string | null) ?? null
    await transferirConversa(ctx.db, {
      conversationId: String(data.conversation_id),
      target: before ? { kind: 'pessoa', userId: before } : { kind: 'ninguem' },
      source: 'harpi',
      note: 'Desfeito pela Harpi',
      fireIntegrations: false,
    })
  },
}

const fecharConversa: ToolDef = {
  name: 'fechar_conversa',
  label: 'Preparou o fechamento de uma conversa',
  risk: 'pequena',
  minRole: 'agent',
  description: 'Fecha (encerra) uma conversa da caixa de entrada.',
  parameters: { type: 'object', properties: { conversa_id: UUID }, required: ['conversa_id'] },
  async prepare(ctx, input) {
    const conv = await loadConversation(ctx, String(input.conversa_id))
    if (conv.status === 'closed') return { error: 'essa conversa já está fechada' }
    return {
      preview: { title: `Fechar conversa de ${(conv.contact as Row | null)?.name ?? 'contato'}`, lines: [] },
      input,
    }
  },
  async execute(ctx, input) {
    const conv = await loadConversation(ctx, String(input.conversa_id))
    const { error } = await ctx.db
      .from('conversations')
      .update({ status: 'closed' })
      .eq('id', String(input.conversa_id))
      .eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui fechar: ${error.message}`)
    return {
      summary: 'Conversa fechada.',
      link: { href: LINKS.conversation(String(input.conversa_id)), label: 'Abrir conversa' },
      undo: { conversation_id: input.conversa_id, status: conv.status },
    }
  },
  async undo(ctx, data) {
    await ctx.db
      .from('conversations')
      .update({ status: data.status })
      .eq('id', String(data.conversation_id))
      .eq('account_id', ctx.accountId)
  },
}

// ------------------------------------------------------------
// Agenda
// ------------------------------------------------------------

const marcarCompromisso: ToolDef = {
  name: 'marcar_compromisso',
  label: 'Preparou um compromisso',
  risk: 'pequena',
  minRole: 'agent',
  description:
    'Marca um compromisso numa agenda (IDs em ver_agenda). inicio = AAAA-MM-DDTHH:MM no fuso da pessoa. avisar_cliente=true manda a confirmação e o lembrete configurados da agenda ao cliente pelo WhatsApp.',
  parameters: {
    type: 'object',
    properties: {
      agenda_id: UUID,
      inicio: { type: 'string', description: 'AAAA-MM-DDTHH:MM' },
      duracao_minutos: { type: 'integer', minimum: 5, maximum: 600 },
      titulo: { type: 'string', maxLength: 160 },
      contato_id: UUID,
      observacoes: { type: 'string', maxLength: 2000 },
      avisar_cliente: { type: 'boolean' },
    },
    required: ['agenda_id', 'inicio'],
  },
  async prepare(ctx, input) {
    const { data: cal } = await ctx.db
      .from('calendars')
      .select('id, name, slot_minutes, is_active')
      .eq('id', String(input.agenda_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!cal) return { error: 'agenda não encontrada neste CRM' }
    const calendar = cal as Row
    const start = parseLocalDateTime(String(input.inicio), ctx.timezone)
    if (!start) return { error: 'inicio precisa ser AAAA-MM-DDTHH:MM' }
    if (start.getTime() < ctx.now.getTime() - 60_000) return { error: 'esse horário já passou' }
    const minutes = Number(input.duracao_minutos) || Number(calendar.slot_minutes) || 30
    const end = new Date(start.getTime() + minutes * 60_000)
    let contactName: string | null = null
    if (input.contato_id) contactName = contactLabel(await loadContact(ctx, String(input.contato_id)))
    const notify = input.avisar_cliente === true && !!input.contato_id
    const lines = [
      `Agenda: ${calendar.name}`,
      `Quando: ${dateTime(start.toISOString(), ctx.timezone)} (${minutes} min)`,
    ]
    if (contactName) lines.push(`Contato: ${contactName}`)
    if (input.titulo) lines.push(`Título: ${input.titulo}`)
    return {
      preview: {
        title: `Marcar compromisso${contactName ? ` com ${contactName}` : ''}`,
        lines,
        badges: notify ? ['Avisa o cliente'] : undefined,
      },
      input: { ...input, starts_at: start.toISOString(), ends_at: end.toISOString(), notify },
      risk: notify ? 'cliente' : 'pequena',
    }
  },
  async execute(ctx, input) {
    const { data, error } = await ctx.db
      .from('calendar_events')
      .insert({
        account_id: ctx.accountId,
        calendar_id: input.agenda_id,
        kind: 'appointment',
        contact_id: (input.contato_id as string) ?? null,
        title: (input.titulo as string) ?? null,
        notes: (input.observacoes as string) ?? null,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        status: 'scheduled',
        notify: input.notify === true,
        created_by: ctx.userId,
        source: 'team',
      })
      .select('id')
      .single()
    if (error || !data) {
      if (error?.code === '23P01') throw new ToolError('Esse horário já está ocupado nessa agenda.')
      throw new ToolError(`Não consegui marcar: ${error?.message ?? ''}`)
    }
    return {
      summary: `Compromisso marcado para ${dateTime(String(input.starts_at), ctx.timezone)}.`,
      link: { href: LINKS.agenda(), label: 'Abrir agenda' },
      undo: { event_id: (data as Row).id },
    }
  },
  async undo(ctx, data) {
    await ctx.db
      .from('calendar_events')
      .update({ status: 'cancelled' })
      .eq('id', String(data.event_id))
      .eq('account_id', ctx.accountId)
  },
}

export const CRM_TOOLS: ToolDef[] = [
  criarContato,
  editarContato,
  alterarContatos,
  adicionarNota,
  criarTarefa,
  concluirTarefa,
  criarNegocio,
  moverNegocio,
  encerrarNegocio,
  atribuirConversa,
  fecharConversa,
  marcarCompromisso,
]

export type { Prepared }
