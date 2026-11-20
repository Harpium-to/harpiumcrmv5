import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Provedor de IA não suportado: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * `[[HANDOFF]]`, or `[[HANDOFF financeiro]]` naming the setor the
 * conversation should go to (see lib/atendimento/destino.ts). Whatever
 * sits inside the brackets is captured, so a marker the model
 * misspells (`[[HANDOFF: Dra. Ana]]`) is still stripped and never
 * reaches the customer.
 */
const HANDOFF_MARKER = /\[\[\s*HANDOFF\b([^\]]*)\]\]/gi

/**
 * Split the raw model output into `{ text, handoff, handoffTeam?, usage }`.
 * The sentinel can appear alone or trailing a partial reply; either way
 * we treat the turn as a handoff and strip the marker from any remaining
 * text. `handoffTeam` is what the model wrote after HANDOFF (a setor
 * code), present only when it wrote one. `usage` is passed straight
 * through (null when the provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  let handoff = raw.includes(HANDOFF_SENTINEL)
  let handoffTeam: string | undefined
  const text = raw
    .replace(HANDOFF_MARKER, (_marker, rest: string) => {
      handoff = true
      const code = rest.replace(/^[\s:=-]+/, '').trim()
      if (code && handoffTeam === undefined) handoffTeam = code
      return ''
    })
    .trim()
  return handoffTeam ? { text, handoff, handoffTeam, usage } : { text, handoff, usage }
}
