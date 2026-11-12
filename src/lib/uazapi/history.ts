import type { SupabaseClient } from '@supabase/supabase-js'

import { findUazapiChats, findUazapiMessages, type UazapiServer } from './api'
import { findOrCreateContact, findOrCreateConversation, MEDIA_LABEL } from './inbound'
import { parseUazapiInbound, type UazapiInboundMessage } from './parse'

// ============================================================
// Bringing the phone's old chats into the CRM (unofficial path).
//
// When a phone pairs, WhatsApp sends the instance its recent history
// (UAZAPI keeps ~90 days). The webhook only carries messages from then
// on, so the inbox starts empty. This copies the 1:1 chats the instance
// already holds — contacts, conversations and messages with their
// original dates — a page of chats at a time.
//
// It is a copy, not an event: no automation, flow, AI reply or agent
// runs, nothing is marked unread, and a closed thread stays closed.
// Safe to run again: a message already in the CRM (same WhatsApp id) is
// skipped, so it also never duplicates what the webhook delivered.
// Media files are not downloaded (UAZAPI keeps them only around the
// time they arrive); the thread says "[foto]" etc. with the caption.
// ============================================================

/** Chats per call: each one is a few queries plus one UAZAPI call. */
export const HISTORY_CHATS_PER_CALL = 5
/** Most recent messages copied per chat. */
export const HISTORY_MESSAGES_PER_CHAT = 300
/** Stop after this many chats in total (a busy number has thousands). */
export const HISTORY_MAX_CHATS = 300

type Dict = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export interface HistoryChat {
  /** The JID to ask UAZAPI for messages (`...@s.whatsapp.net`). */
  chatid: string
  phone: string
  lid: string | null
  name: string | null
}

/**
 * A 1:1 chat we can copy, or null (groups, channels, Status, a chat
 * known only by LID — without a number there is no contact to make).
 */
export function chatFromUazapi(chat: Dict): HistoryChat | null {
  if (chat.wa_isGroup === true) return null
  const chatid = str(chat.wa_chatid)
  if (!chatid || !chatid.endsWith('@s.whatsapp.net')) return null
  const phone = chatid.split('@')[0].replace(/\D/g, '')
  if (phone.length < 8) return null
  const lidJid = str(chat.wa_chatlid)
  const lid = lidJid && lidJid.includes('@lid') ? lidJid.split('@')[0].replace(/\D/g, '') || null : null
  const name = str(chat.wa_contactName) ?? str(chat.name) ?? str(chat.wa_name)
  return { chatid, phone, lid, name }
}

export interface HistoryRow {
  sender_type: 'customer' | 'agent'
  content_type: 'text' | 'interactive'
  content_text: string | null
  message_id: string
  status: 'delivered'
  created_at: string
  interactive_reply_id?: string
}

/**
 * The messages of one chat as rows to insert, oldest first. Messages
 * without an id or a date are left out: without an id a re-run would
 * duplicate them, without a date they would land "now" in the thread.
 */
export function historyRows(messages: Dict[]): HistoryRow[] {
  const rows: HistoryRow[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    const [msg] = parseUazapiInbound({ EventType: 'messages', message }) as (UazapiInboundMessage | undefined)[]
    if (!msg || !msg.externalId || !msg.sentAt || seen.has(msg.externalId)) continue
    seen.add(msg.externalId)
    const text = msg.mediaKind
      ? [MEDIA_LABEL[msg.mediaKind], msg.text].filter(Boolean).join(' ')
      : msg.text || null
    rows.push({
      sender_type: msg.fromMe ? 'agent' : 'customer',
      content_type: msg.interactiveReplyId ? 'interactive' : 'text',
      content_text: text,
      message_id: msg.externalId,
      status: 'delivered',
      created_at: msg.sentAt,
      ...(msg.interactiveReplyId ? { interactive_reply_id: msg.interactiveReplyId } : {}),
    })
  }
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export interface HistoryChatResult {
  imported: number
  contactCreated: boolean
}

/** Copy one chat: contact, conversation, and the messages not yet stored. */
export async function importHistoryChat(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  srv: UazapiServer,
  chat: HistoryChat,
): Promise<HistoryChatResult> {
  const messages = await findUazapiMessages(srv, chat.chatid, HISTORY_MESSAGES_PER_CHAT)
  const rows = historyRows(messages)
  if (rows.length === 0) return { imported: 0, contactCreated: false }

  const contact = await findOrCreateContact(
    admin,
    account.id,
    account.ownerUserId,
    chat.phone,
    chat.name,
    chat.lid,
  )
  if (!contact) return { imported: 0, contactCreated: false }
  // Old chats never open a deal in the funnel: only a live first
  // message from the person does (ingestUazapiInbound, first-contact.ts).
  const conversation = await findOrCreateConversation(admin, account.id, account.ownerUserId, contact.id)
  if (!conversation) return { imported: 0, contactCreated: contact.created }
  const conversationId = conversation.id

  // What is already in the CRM (from the webhook or an earlier run).
  const ids = rows.map((r) => r.message_id)
  const known = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversationId)
      .in('message_id', ids.slice(i, i + 200))
    for (const r of (data ?? []) as { message_id: string | null }[]) {
      if (r.message_id) known.add(r.message_id)
    }
  }
  const fresh = rows.filter((r) => !known.has(r.message_id))
  if (fresh.length === 0) return { imported: 0, contactCreated: contact.created }

  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await admin
      .from('messages')
      .insert(fresh.slice(i, i + 200).map((r) => ({ ...r, conversation_id: conversationId })))
    if (error) throw new Error(`falha ao gravar mensagens: ${error.message}`)
  }

  // The thread's preview moves only forward: history older than what
  // the webhook already brought never replaces the latest message.
  const newest = fresh[fresh.length - 1]
  const { data: conv } = await admin
    .from('conversations')
    .select('last_message_at')
    .eq('id', conversationId)
    .maybeSingle()
  const current = (conv as { last_message_at?: string | null } | null)?.last_message_at ?? null
  if (!current || new Date(current).getTime() < new Date(newest.created_at).getTime()) {
    await admin
      .from('conversations')
      .update({
        last_message_text: newest.content_text ?? '',
        last_message_at: newest.created_at,
      })
      .eq('id', conversationId)
  }

  return { imported: fresh.length, contactCreated: contact.created }
}

export interface HistoryPageResult {
  chats: number
  imported: number
  contactsCreated: number
  /** Where the next call starts, or null when everything was copied. */
  nextOffset: number | null
}

/** One page of chats, starting at `offset`. */
export async function importHistoryPage(
  admin: SupabaseClient,
  account: { id: string; ownerUserId: string },
  srv: UazapiServer,
  offset: number,
): Promise<HistoryPageResult> {
  const page = await findUazapiChats(srv, { limit: HISTORY_CHATS_PER_CALL, offset })
  let imported = 0
  let contactsCreated = 0
  let chats = 0
  for (const raw of page.chats) {
    const chat = chatFromUazapi(raw)
    if (!chat) continue
    const r = await importHistoryChat(admin, account, srv, chat)
    chats++
    imported += r.imported
    if (r.contactCreated) contactsCreated++
  }
  const next = page.nextOffset
  return {
    chats,
    imported,
    contactsCreated,
    nextOffset: next !== null && next < HISTORY_MAX_CHATS ? next : null,
  }
}
