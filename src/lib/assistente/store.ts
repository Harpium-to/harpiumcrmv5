import type { SupabaseClient } from '@supabase/supabase-js'

import type { LlmBlock, LlmMessage } from '@/lib/ai/tool-chat'

import type { StoredMessage, StoredToolResult } from './types'

// ============================================================
// Conversations with Harpi: persistence, and the conversion of what
// was stored into the transcript the model reads.
// ============================================================

/** Messages the model gets back per turn. Older ones fall off. */
export const HISTORY_WINDOW = 40

/** Tool results older than the last couple of turns are shortened. */
const OLD_RESULT_MAX = 1_500

export class NotInstalledError extends Error {
  constructor() {
    super('O Harpi ainda não foi instalado neste banco (migration 074).')
    this.name = 'NotInstalledError'
  }
}

/** A table that does not exist yet: 42P01 from Postgres, PGRST205 from PostgREST. */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export async function createConversation(
  db: SupabaseClient,
  args: { accountId: string; userId: string; title: string | null; origin?: 'chat' | 'routine' },
): Promise<string> {
  const { data, error } = await db
    .from('assistant_conversations')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      title: args.title,
      origin: args.origin ?? 'chat',
    })
    .select('id')
    .single()
  if (error || !data) {
    if (isMissingTable(error)) throw new NotInstalledError()
    throw new Error(`não consegui abrir a conversa: ${error?.message ?? ''}`)
  }
  return (data as { id: string }).id
}

export async function appendMessage(
  db: SupabaseClient,
  args: {
    conversationId: string
    accountId: string
    role: StoredMessage['role']
    content: Record<string, unknown>
    promptTokens?: number | null
    completionTokens?: number | null
  },
): Promise<void> {
  const { error } = await db.from('assistant_messages').insert({
    conversation_id: args.conversationId,
    account_id: args.accountId,
    role: args.role,
    content: args.content,
    prompt_tokens: args.promptTokens ?? null,
    completion_tokens: args.completionTokens ?? null,
  })
  if (error) throw new Error(`não consegui salvar a mensagem: ${error.message}`)
  await db
    .from('assistant_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', args.conversationId)
}

/** The last `limit` messages, oldest first. */
export async function loadMessages(
  db: SupabaseClient,
  conversationId: string,
  limit = HISTORY_WINDOW,
): Promise<StoredMessage[]> {
  const { data, error } = await db
    .from('assistant_messages')
    .select('id, seq, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(limit)
  if (error) {
    if (isMissingTable(error)) throw new NotInstalledError()
    throw new Error(`não consegui ler a conversa: ${error.message}`)
  }
  return ((data ?? []) as StoredMessage[]).reverse()
}

/** "[Sistema] …" lines the model reads as part of the user's turn. */
export function eventText(content: Record<string, unknown>): string {
  return `[Sistema] ${String(content.text ?? '')}`
}

/**
 * Stored rows → the provider-neutral transcript. Old tool results are
 * shortened: they stay in every later request, and after a couple of
 * turns the model needs the gist, not 12 KB of contacts.
 */
export function toLlmMessages(messages: StoredMessage[]): LlmMessage[] {
  const out: LlmMessage[] = []
  const toolIndexes = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0)
  const recentTools = new Set(toolIndexes.slice(-3))

  messages.forEach((m, i) => {
    const c = m.content ?? {}
    if (m.role === 'user') {
      out.push({ role: 'user', text: String(c.text ?? '') })
    } else if (m.role === 'event') {
      out.push({ role: 'user', text: eventText(c) })
    } else if (m.role === 'assistant') {
      const blocks = (Array.isArray(c.blocks) ? c.blocks : []) as LlmBlock[]
      out.push({ role: 'assistant', blocks })
    } else if (m.role === 'tool') {
      const results = (Array.isArray(c.results) ? c.results : []) as StoredToolResult[]
      out.push({
        role: 'tool_results',
        results: results.map((r) => ({
          id: r.id,
          name: r.name,
          isError: r.isError,
          content:
            recentTools.has(i) || r.content.length <= OLD_RESULT_MAX
              ? r.content
              : `${r.content.slice(0, OLD_RESULT_MAX)}… [resultado antigo encurtado]`,
        })),
      })
    }
  })
  return out
}

/** Model turns since the person (or a card decision) last spoke. */
export function stepsSinceUser(messages: StoredMessage[]): number {
  let n = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role
    if (role === 'user' || role === 'event') break
    if (role === 'assistant') n++
  }
  return n
}

/** A title from the first thing the person said. */
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 59)}…` : t
}
