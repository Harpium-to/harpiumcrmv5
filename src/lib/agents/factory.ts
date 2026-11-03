import { generateReply } from '@/lib/ai/generate'
import type { AiConfig } from '@/lib/ai/types'
import { AGENT_ROLES } from './roles'
import { TOOL_IDS, AGENT_CHANNELS, sanitizeChannels, sanitizeTools } from './tools'
import { toAutonomy } from './autonomy'
import { normalizeKeywords } from './payload'

// ============================================================
// The agent factory: a sentence in, a configuration out.
//
// "Crie um agente que prospecte empresas de móveis planejados em
// Palmas, encontre os donos e marque reunião" is how someone actually
// describes what they want. Turning that into twelve form fields is
// work the model can do, and the operator reviews rather than authors.
//
// WHY THE MODEL DOESN'T GET THE LAST WORD
//   `parseDraft` is a pure function that takes the model's text and
//   produces a configuration, and it constrains everything that
//   matters: tools must exist in the catalogue, channels must be real,
//   autonomy is clamped, and the draft always comes back INACTIVE at
//   the lowest autonomy regardless of what the model suggested. A
//   model that hallucinates a `send_invoice` tool or decides its new
//   agent should be fully autonomous produces a draft that is merely
//   wrong, not a draft that is dangerous.
// ============================================================

export interface DraftedAgent {
  name: string
  role: string
  department: string
  objective: string
  systemPrompt: string
  keywords: string[]
  tools: string[]
  channels: string[]
  autonomy: number
  goals: Record<string, number>
  priority: number
}

/** The brief the model works to. */
export function buildFactoryPrompt(): string {
  const roles = AGENT_ROLES.map((r) => r.id).join(', ')
  return `Você configura agentes de IA para uma operação comercial. Recebe a descrição de um agente em linguagem natural e devolve a configuração estruturada dele.

Responda APENAS com um objeto JSON, sem markdown, sem cercas de código, sem comentários e sem texto antes ou depois.

Campos:
- "name": nome curto do agente, até 40 caracteres, em português.
- "role": um destes exatamente: ${roles}, custom.
- "department": setor em minúsculas, sem acento, uma palavra (ex: prospeccao, vendas, atendimento).
- "objective": uma frase dizendo para que serve o agente. Até 200 caracteres.
- "system_prompt": as instruções completas do agente, em português. Entre 150 e 2000 caracteres. Deve conter: o que ele faz, como conduz a conversa, e uma seção explícita do que ele NUNCA faz. Inclua sempre a proibição de inventar preço, prazo, condição ou disponibilidade.
- "keywords": lista de palavras que, aparecendo na mensagem do cliente, indicam que este agente deve assumir. Entre 0 e 15 itens, em português, minúsculas.
- "tools": lista com os recursos necessários, escolhidos entre: ${TOOL_IDS.join(', ')}. Conceda o mínimo necessário para a função descrita.
- "channels": lista entre: ${AGENT_CHANNELS.join(', ')}. Lista vazia se o agente não fala com cliente.
- "goals": objeto com metas numéricas, ex: {"leads_per_day": 20}. Objeto vazio se a descrição não mencionar meta.
- "priority": número de 0 a 100. Use 30 para agentes especialistas e 10 para agentes gerais.

Regras:
- Use apenas ferramentas e canais das listas acima. Não invente nomes.
- Se a descrição não disser algo, escolha o padrão mais conservador.
- O prompt do agente é escrito para o próprio agente, na segunda pessoa ("Você é...").`
}

/** Strip the code fence a model adds despite being told not to. */
function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

/**
 * Extract the outermost JSON object from a response.
 *
 * Models prepend "Claro! Aqui está:" often enough that demanding a
 * bare object would fail on otherwise-correct output. Scanning for the
 * first balanced `{...}` recovers those without being fooled by a
 * brace inside a string literal.
 */
function extractJsonObject(text: string): string | null {
  const source = stripFence(text)
  const start = source.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

const VALID_ROLES = new Set([...AGENT_ROLES.map((r) => r.id), 'custom'])

/**
 * Turn the model's text into a configuration, or null if it is
 * unusable.
 *
 * Pure, so the constraints are testable without a provider call. Note
 * what it does *not* trust: the role has to be in the catalogue, tools
 * and channels are filtered against their vocabularies, and autonomy
 * is clamped. The caller then forces the draft inactive — a generated
 * agent never starts switched on.
 */
export function parseDraft(text: string): DraftedAgent | null {
  const json = extractJsonObject(text)
  if (!json) return null

  let raw: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    raw = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  const systemPrompt =
    typeof raw.system_prompt === 'string' ? raw.system_prompt.trim() : ''
  // A draft without these two is not a draft — the operator would have
  // to write the whole thing anyway, and showing an empty form as a
  // "suggestion" is worse than admitting the generation failed.
  if (!name || systemPrompt.length < 40) return null

  const roleRaw = typeof raw.role === 'string' ? raw.role.trim() : ''
  const role = VALID_ROLES.has(roleRaw) ? roleRaw : 'custom'

  const departmentRaw =
    typeof raw.department === 'string' ? raw.department.trim() : ''
  const department =
    departmentRaw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40) || 'geral'

  const objective =
    typeof raw.objective === 'string' ? raw.objective.trim().slice(0, 400) : ''

  const priorityRaw = Number(raw.priority)
  const priority = Number.isFinite(priorityRaw)
    ? Math.min(100, Math.max(0, Math.round(priorityRaw)))
    : 10

  const goals: Record<string, number> = {}
  if (raw.goals && typeof raw.goals === 'object' && !Array.isArray(raw.goals)) {
    for (const [key, value] of Object.entries(
      raw.goals as Record<string, unknown>,
    )) {
      const n = Number(value)
      const slug = key.trim().slice(0, 40)
      if (slug && Number.isFinite(n) && n >= 0) goals[slug] = Math.round(n)
    }
  }

  return {
    name,
    role,
    department,
    objective,
    systemPrompt: systemPrompt.slice(0, 8000),
    keywords: normalizeKeywords(raw.keywords),
    tools: sanitizeTools(raw.tools),
    channels: sanitizeChannels(raw.channels),
    // Whatever the model proposed, a generated agent starts assisted.
    // The operator raises it after reading what it actually wrote.
    autonomy: toAutonomy(1),
    goals,
    priority,
  }
}

/**
 * Draft an agent from a natural-language description.
 *
 * Runs on the account's own provider key, like every other AI call in
 * the app. Throws when the model's output can't be parsed — the UI
 * shows that rather than a half-filled form, because a silent partial
 * draft is one the operator saves without noticing what is missing.
 */
export async function draftAgent(
  config: AiConfig,
  description: string,
): Promise<DraftedAgent> {
  const { text } = await generateReply({
    config,
    systemPrompt: buildFactoryPrompt(),
    messages: [{ role: 'user', content: description }],
  })

  const draft = parseDraft(text)
  if (!draft) {
    throw new Error('O modelo não devolveu uma configuração válida.')
  }
  return draft
}
