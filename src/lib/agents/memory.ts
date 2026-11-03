import type { SupabaseClient } from '@supabase/supabase-js'
import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings'
import { loadEmbeddingsKey } from '@/lib/ai/config'

// ============================================================
// What the agents learned.
//
// Separate from the CRM record and from the knowledge base, because
// it answers a different question. The CRM says what the customer *is*
// (phone, stage, value). The knowledge base says what the company
// sells. Memory says what happened and what it meant: "achou caro na
// primeira conversa", "só decide com o sócio", "pediu para chamar em
// novembro". Those are the things a good rep remembers and a database
// column has nowhere to put.
//
// Three scopes:
//   contact — about this customer. Every agent that touches them sees it.
//   team    — about the operation. Shared learning: an objection the
//             SDR heard should reach the closer.
//   agent   — this agent's own working notes.
//
// Retrieval widens rather than narrows (see the SQL in migration 045):
// an agent asking about a contact gets that contact's memory, the
// team's, and its own.
// ============================================================

export type MemoryScope = 'agent' | 'team' | 'contact'
export type MemoryKind =
  | 'fact'
  | 'objection'
  | 'preference'
  | 'outcome'
  | 'instruction'

export interface RememberArgs {
  accountId: string
  agentId: string
  contactId: string | null
  scope: MemoryScope
  kind: MemoryKind
  content: string
}

/**
 * Write one memory.
 *
 * Embedded when the account has an embeddings key, lexical-only
 * otherwise — the same graceful downgrade the knowledge base makes,
 * and the reason an Anthropic-only account (no embeddings API) still
 * gets working recall.
 *
 * Never throws: a lost memory must not fail the task that produced it.
 */
export async function rememberFact(
  db: SupabaseClient,
  args: RememberArgs,
): Promise<void> {
  const content = args.content.trim().slice(0, 2000)
  if (!content) return

  try {
    // Stored as a '[0.1,0.2,…]' literal, not a JSON array: PostgREST
    // writes RPC and table payloads as JSON, and a JSON array does not
    // coerce into a `vector` column. Same contract the knowledge base
    // uses on both the read and the write side.
    let embedding: string | null = null
    try {
      const { key } = await loadEmbeddingsKey(db, args.accountId)
      if (key) {
        const [vector] = await embedTexts(key, [content])
        embedding = vector ? toVectorLiteral(vector) : null
      }
    } catch {
      // Semantic recall degrades to lexical. Not worth failing a write
      // over — the row is still findable by full-text search.
    }

    const { error } = await db.from('agent_memory').insert({
      account_id: args.accountId,
      agent_id: args.agentId,
      contact_id: args.contactId,
      scope: args.scope,
      kind: args.kind,
      content,
      embedding,
    })
    if (error) throw error
  } catch (err) {
    console.error('[agents memory] could not store:', err)
  }
}

export interface RecallArgs {
  accountId: string
  agentId: string
  contactId: string | null
  query: string
  limit?: number
}

/**
 * Recall what is relevant to `query`.
 *
 * Semantic when an embeddings key exists, full-text otherwise. Returns
 * plain strings because that is all the prompt needs, and handing the
 * caller rows would invite it to render memory as if it were verified
 * CRM data — it is the agent's recollection, and the prompt labels it
 * as reference rather than fact.
 *
 * Never throws: an agent with no memory is still an agent.
 */
export async function recallMemory(
  db: SupabaseClient,
  args: RecallArgs,
): Promise<string[]> {
  const query = args.query.trim().slice(0, 1000)
  if (!query) return []
  const limit = args.limit ?? 6

  try {
    const { key } = await loadEmbeddingsKey(db, args.accountId)
    if (key) {
      try {
        const [vector] = await embedTexts(key, [query])
        if (vector) {
          const { data, error } = await db.rpc('match_agent_memory_semantic', {
            p_account_id: args.accountId,
            p_agent_id: args.agentId,
            p_contact_id: args.contactId,
            // Serialised as a '[0.1,0.2,…]' literal and cast in SQL —
            // a JSON array cannot cross the PostgREST boundary as a
            // `vector`. Same contract as the knowledge base.
            p_embedding: toVectorLiteral(vector),
            p_limit: limit,
          })
          if (!error && data) {
            return (data as Array<{ content: string }>).map((r) => r.content)
          }
        }
      } catch {
        // Fall through to lexical below.
      }
    }

    const { data, error } = await db.rpc('match_agent_memory_fts', {
      p_account_id: args.accountId,
      p_agent_id: args.agentId,
      p_contact_id: args.contactId,
      p_query: query,
      p_limit: limit,
    })
    if (error) throw error
    return (data as Array<{ content: string }> | null ?? []).map((r) => r.content)
  } catch (err) {
    console.error('[agents memory] recall failed:', err)
    return []
  }
}
