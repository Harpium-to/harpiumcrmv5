import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type?: string | null
  content_text: string | null
  template_name?: string | null
  interactive_payload?: unknown
}

/**
 * Message kinds the model reads. A template (the API's approved
 * message, often an automation's greeting) and buttons / lists carry
 * text the customer saw; leaving them out made the AI greet a customer
 * the business had just greeted. Media carries no text to model.
 */
const READABLE_TYPES = ['text', 'template', 'interactive']

/** A template's body as the customer read it, with "…" for its {{1}}. */
export function templatePreview(body: string): string {
  return body.replace(/\{\{\s*\d+\s*\}\}/g, '…').trim()
}

/** The text one message showed the customer, or null. */
export function messageText(
  row: DbMessage,
  templateBodies: Map<string, string> = new Map(),
): string | null {
  const own = row.content_text?.trim()
  if (own) return own
  if (row.content_type === 'template' && row.template_name) {
    const body = templateBodies.get(row.template_name)
    return body ? templatePreview(body) : `[modelo de mensagem "${row.template_name}"]`
  }
  if (row.content_type === 'interactive' && row.interactive_payload) {
    const body = (row.interactive_payload as { body?: unknown }).body
    if (typeof body === 'string' && body.trim()) return body.trim()
  }
  return null
}

/**
 * Body text of the templates named in `rows`, from the account that
 * owns the conversation. Best-effort: a template it can't find reads
 * as its name.
 */
async function loadTemplateBodies(
  db: SupabaseClient,
  conversationId: string,
  rows: DbMessage[],
): Promise<Map<string, string>> {
  const names = Array.from(
    new Set(
      rows
        .filter((r) => r.content_type === 'template' && !r.content_text?.trim() && r.template_name)
        .map((r) => r.template_name as string),
    ),
  )
  const bodies = new Map<string, string>()
  if (names.length === 0) return bodies
  try {
    const { data: conv } = await db
      .from('conversations')
      .select('account_id')
      .eq('id', conversationId)
      .maybeSingle()
    const accountId = (conv as { account_id?: string } | null)?.account_id
    if (!accountId) return bodies
    const { data } = await db
      .from('message_templates')
      .select('name, body_text')
      .eq('account_id', accountId)
      .in('name', names)
    for (const t of (data ?? []) as { name: string; body_text: string | null }[]) {
      if (t.body_text?.trim() && !bodies.has(t.name)) bodies.set(t.name, t.body_text)
    }
  } catch (err) {
    console.error('[ai context] template bodies unavailable:', err)
  }
  return bodies
}

/**
 * Fetch the last N messages with text of a conversation and map them
 * to the provider-neutral chat shape. Customer messages become `user`;
 * agent and bot messages (automations included) become `assistant`.
 * Templates and buttons / lists count, with the text the customer saw.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, template_name, interactive_payload')
    .eq('conversation_id', conversationId)
    .in('content_type', READABLE_TYPES)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const bodies = await loadTemplateBodies(db, conversationId, rows)
  const out: ChatMessage[] = []
  for (const m of rows) {
    const content = messageText(m, bodies)
    if (!content) continue
    out.push({ role: m.sender_type === 'customer' ? 'user' : 'assistant', content })
  }
  return out
}
