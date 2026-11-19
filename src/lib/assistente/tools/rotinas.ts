import { clip, dateTime, safeZone } from '../format'
import { describeSchedule, nextRunAt } from '../time'
import { ToolError, type ToolContext, type ToolDef } from '../types'

// ============================================================
// Phase 3/4 — the bot's own routines, and its memory of the CRM.
//
// A routine is an instruction the bot runs on a schedule, as its
// owner, with READ tools only; whatever it wants to change becomes a
// card waiting for the owner (routines.ts). So a routine is born ON:
// it cannot change anything by itself.
//
// Memory: short facts the team teaches the bot ("nunca mandamos
// mensagem depois das 20h"). They go into every conversation's
// instructions, for everyone in the CRM.
// ============================================================

type Row = Record<string, unknown>

const UUID = { type: 'string', format: 'uuid' } as const

export const MEMORY_MAX = 40

const DAYS = { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 }, minItems: 1, maxItems: 7 }
const TIME = { type: 'string', description: 'HH:MM (24h), no fuso da pessoa.' }

function checkTime(value: unknown): string | null {
  const v = String(value ?? '').trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function loadRoutine(ctx: ToolContext, id: string): Promise<Row> {
  const { data } = await ctx.admin
    .from('assistant_routines')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  const r = data as Row | null
  if (!r) throw new ToolError('Rotina não encontrada neste CRM.')
  const isAdmin = ctx.role === 'admin' || ctx.role === 'owner'
  if (r.user_id !== ctx.userId && !isAdmin) throw new ToolError('Essa rotina é de outra pessoa.')
  return r
}

const listarRotinas: ToolDef = {
  name: 'listar_rotinas',
  label: 'Olhou as rotinas',
  risk: 'leitura',
  minRole: 'viewer',
  description: 'As rotinas do Harpi de quem pergunta (e, para administradores, as da equipe): o que fazem e quando rodam.',
  parameters: { type: 'object', properties: {} },
  async run(ctx) {
    const { data, error } = await ctx.db
      .from('assistant_routines')
      .select('id, user_id, name, instruction, weekdays, run_time, timezone, is_active, next_run_at, last_run_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(50)
    if (error) throw new ToolError(`Não consegui ler as rotinas: ${error.message}`)
    return {
      rotinas: ((data ?? []) as Row[]).map((r) => ({
        id: r.id,
        nome: r.name,
        instrucao: clip(r.instruction as string, 300),
        quando: describeSchedule((r.weekdays ?? []) as number[], String(r.run_time)),
        ligada: r.is_active,
        proxima: dateTime(r.next_run_at as string, ctx.timezone),
        ultima: dateTime(r.last_run_at as string, ctx.timezone),
        sua: r.user_id === ctx.userId ? true : undefined,
      })),
      link: '/settings?tab=assistente',
    }
  },
}

const criarRotina: ToolDef = {
  name: 'criar_rotina',
  label: 'Montou uma rotina',
  risk: 'maior',
  minRole: 'agent',
  description:
    'Cria uma rotina do Harpi: uma instrução que ele executa sozinho nos dias e no horário escolhidos (dias ISO: 1=segunda … 7=domingo), só consultando. O resultado chega nas notificações e numa conversa do Harpi. Se a instrução pedir mudanças, ele deixa cartões esperando o OK de quem criou.',
  parameters: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      instrucao: { type: 'string', minLength: 5, maxLength: 2000, description: 'O que fazer a cada vez, escrito como um pedido.' },
      dias: DAYS,
      horario: TIME,
    },
    required: ['nome', 'instrucao', 'dias', 'horario'],
  },
  async prepare(ctx, input) {
    const time = checkTime(input.horario)
    if (!time) return { error: 'horario precisa ser HH:MM' }
    const days = [...new Set(input.dias as number[])].sort()
    const zone = safeZone(ctx.timezone)
    const next = nextRunAt(days, time, zone, ctx.now)
    if (!next) return { error: 'escolha pelo menos um dia' }
    const { count } = await ctx.admin
      .from('assistant_routines')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
    if ((count ?? 0) >= 10) return { error: 'cada pessoa pode ter até 10 rotinas; apague ou desligue uma antes' }
    return {
      preview: {
        title: `Criar rotina: ${clip(String(input.nome), 60)}`,
        lines: [
          `Quando: ${describeSchedule(days, time)} (${zone})`,
          `O que faz: ${clip(String(input.instrucao), 400)}`,
          `Primeira vez: ${dateTime(next.toISOString(), zone)}`,
        ],
        badges: ['Só consulta', 'Mudanças pedem seu OK'],
      },
      input: { ...input, dias: days, horario: time, timezone: zone },
    }
  },
  async execute(ctx, input) {
    const days = input.dias as number[]
    const time = String(input.horario)
    const zone = String(input.timezone)
    const next = nextRunAt(days, time, zone, new Date())
    const { data, error } = await ctx.admin
      .from('assistant_routines')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name: input.nome,
        instruction: input.instrucao,
        weekdays: days,
        run_time: time,
        timezone: zone,
        is_active: true,
        next_run_at: next?.toISOString() ?? null,
      })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui criar a rotina: ${error?.message ?? ''}`)
    return {
      summary: `Rotina "${input.nome}" criada: ${describeSchedule(days, time)}.`,
      link: { href: '/settings?tab=assistente', label: 'Ver rotinas' },
      undo: { routine_id: (data as Row).id },
    }
  },
  async undo(ctx, data) {
    await ctx.admin.from('assistant_routines').delete().eq('id', String(data.routine_id)).eq('account_id', ctx.accountId)
  },
}

const alterarRotina: ToolDef = {
  name: 'alterar_rotina',
  label: 'Preparou uma alteração de rotina',
  risk: 'maior',
  minRole: 'agent',
  description: 'Liga, desliga, apaga ou muda (nome, instrução, dias, horário) uma rotina do Harpi.',
  parameters: {
    type: 'object',
    properties: {
      rotina_id: UUID,
      acao: { type: 'string', enum: ['ligar', 'desligar', 'apagar', 'mudar'] },
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      instrucao: { type: 'string', minLength: 5, maxLength: 2000 },
      dias: DAYS,
      horario: TIME,
    },
    required: ['rotina_id', 'acao'],
  },
  async prepare(ctx, input) {
    const r = await loadRoutine(ctx, String(input.rotina_id))
    const lines: string[] = []
    const update: Row = {}
    if (input.acao === 'mudar') {
      if (input.nome) update.name = input.nome
      if (input.instrucao) update.instruction = input.instrucao
      if (input.dias) update.weekdays = [...new Set(input.dias as number[])].sort()
      if (input.horario) {
        const t = checkTime(input.horario)
        if (!t) return { error: 'horario precisa ser HH:MM' }
        update.run_time = t
      }
      if (Object.keys(update).length === 0) return { error: 'diga o que mudar' }
      if (update.name) lines.push(`Nome: "${r.name}" → "${update.name}"`)
      if (update.instruction) lines.push(`Instrução nova: ${clip(String(update.instruction), 300)}`)
      if (update.weekdays || update.run_time) {
        lines.push(
          `Quando: ${describeSchedule((update.weekdays ?? r.weekdays) as number[], String(update.run_time ?? r.run_time))}`,
        )
      }
    } else {
      lines.push(`Rotina: ${describeSchedule(r.weekdays as number[], String(r.run_time))}`)
    }
    const verb = { ligar: 'Ligar', desligar: 'Desligar', apagar: 'Apagar', mudar: 'Alterar' }[String(input.acao)]
    return {
      preview: { title: `${verb} rotina: ${clip(String(r.name), 60)}`, lines },
      input: { rotina_id: r.id, acao: input.acao, update },
    }
  },
  async execute(ctx, input) {
    const r = await loadRoutine(ctx, String(input.rotina_id))
    const id = String(r.id)
    const previous = {
      name: r.name,
      instruction: r.instruction,
      weekdays: r.weekdays,
      run_time: r.run_time,
      is_active: r.is_active,
      next_run_at: r.next_run_at,
    }
    if (input.acao === 'apagar') {
      await ctx.admin.from('assistant_routines').delete().eq('id', id).eq('account_id', ctx.accountId)
      return { summary: `Rotina "${r.name}" apagada.` }
    }
    const update: Row = { ...((input.update ?? {}) as Row), updated_at: new Date().toISOString() }
    if (input.acao === 'ligar') update.is_active = true
    if (input.acao === 'desligar') update.is_active = false
    const days = (update.weekdays ?? r.weekdays) as number[]
    const time = String(update.run_time ?? r.run_time)
    const next = nextRunAt(days, time, String(r.timezone), new Date())
    update.next_run_at = next?.toISOString() ?? null
    const { error } = await ctx.admin.from('assistant_routines').update(update).eq('id', id).eq('account_id', ctx.accountId)
    if (error) throw new ToolError(`Não consegui alterar a rotina: ${error.message}`)
    return {
      summary: `Rotina "${update.name ?? r.name}" ${input.acao === 'ligar' ? 'ligada' : input.acao === 'desligar' ? 'desligada' : 'alterada'}.`,
      link: { href: '/settings?tab=assistente', label: 'Ver rotinas' },
      undo: { routine_id: id, previous },
    }
  },
  async undo(ctx, data) {
    await ctx.admin
      .from('assistant_routines')
      .update(data.previous as Row)
      .eq('id', String(data.routine_id))
      .eq('account_id', ctx.accountId)
  },
}

const lembrar: ToolDef = {
  name: 'lembrar',
  label: 'Preparou algo para lembrar',
  risk: 'pequena',
  minRole: 'agent',
  description:
    'Guarda um fato ou preferência sobre ESTE CRM para o Harpi lembrar sempre, para toda a equipe (ex.: "o ticket médio é R$ 4 mil", "nunca mandar mensagem depois das 20h"). Use quando pedirem para lembrar.',
  parameters: {
    type: 'object',
    properties: { fato: { type: 'string', minLength: 3, maxLength: 500 } },
    required: ['fato'],
  },
  async prepare(ctx, input) {
    const { count } = await ctx.admin
      .from('assistant_memory')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    if ((count ?? 0) >= MEMORY_MAX) return { error: `a memória já tem ${MEMORY_MAX} itens; apague algum em Configurações › Harpi` }
    return {
      preview: { title: 'Lembrar para o CRM', lines: [`"${clip(String(input.fato), 400)}"`], badges: ['Vale para toda a equipe'] },
      input,
    }
  },
  async execute(ctx, input) {
    const { data, error } = await ctx.admin
      .from('assistant_memory')
      .insert({ account_id: ctx.accountId, content: String(input.fato), created_by: ctx.userId })
      .select('id')
      .single()
    if (error || !data) throw new ToolError(`Não consegui guardar: ${error?.message ?? ''}`)
    return { summary: 'Guardado na memória do Harpi.', undo: { memory_id: (data as Row).id } }
  },
  async undo(ctx, data) {
    await ctx.admin.from('assistant_memory').delete().eq('id', String(data.memory_id)).eq('account_id', ctx.accountId)
  },
}

const esquecer: ToolDef = {
  name: 'esquecer',
  label: 'Preparou algo para esquecer',
  risk: 'pequena',
  minRole: 'agent',
  description: 'Apaga um item da memória do Harpi (o ID aparece na lista de memória das instruções).',
  parameters: { type: 'object', properties: { memoria_id: UUID }, required: ['memoria_id'] },
  async prepare(ctx, input) {
    const { data } = await ctx.admin
      .from('assistant_memory')
      .select('id, content')
      .eq('id', String(input.memoria_id))
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!data) return { error: 'esse item não está na memória deste CRM' }
    return {
      preview: { title: 'Esquecer', lines: [`"${clip(String((data as Row).content), 400)}"`] },
      input: { ...input, content: (data as Row).content },
    }
  },
  async execute(ctx, input) {
    await ctx.admin.from('assistant_memory').delete().eq('id', String(input.memoria_id)).eq('account_id', ctx.accountId)
    return { summary: 'Esquecido.', undo: { content: input.content } }
  },
  async undo(ctx, data) {
    await ctx.admin
      .from('assistant_memory')
      .insert({ account_id: ctx.accountId, content: String(data.content), created_by: ctx.userId })
  },
}

export const ROUTINE_TOOLS: ToolDef[] = [listarRotinas, criarRotina, alterarRotina, lembrar, esquecer]
