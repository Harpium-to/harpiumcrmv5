// ============================================================
// WhatsApp connect link without login (Fase A, migration 081).
//
// Whoever runs the company's Facebook often has no login to the CRM.
// An admin (or the agency) generates a link; opened, it connects the
// OFFICIAL WhatsApp of that one CRM and nothing else.
//
//   - the token is random; only its SHA-256 reaches the database;
//   - 7 days, one connection; a new link cancels the open ones;
//   - always used with the service-role client (the table is closed
//     to anon and authenticated).
// ============================================================

import { createHash, randomBytes } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingTable } from '@/lib/auth/account-context'

export const CONNECT_LINK_DAYS = 7
export const CONNECT_LINK_PATH = '/conectar-whatsapp'

/** base64url of 32 random bytes: 43 characters. */
export const CONNECT_TOKEN = /^[A-Za-z0-9_-]{43}$/

export type ConnectLinkVia = 'crm' | 'agencia'

export class ConnectLinkUnavailableError extends Error {
  status = 503
  constructor() {
    super('Esta opção ainda não foi ativada (falta a atualização do banco).')
  }
}

export function hashConnectToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function connectLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${CONNECT_LINK_PATH}/${token}`
}

/** The message that goes with the link when sent over WhatsApp. */
export function connectLinkMessage(link: string, crmName?: string | null): string {
  const target = crmName ? ` ao CRM ${crmName}` : ' ao CRM'
  return [
    `Olá! Para ligar o WhatsApp da sua empresa${target}, abra este link e clique em "Conectar com o Facebook". Não precisa de login:`,
    link,
    `Leva uns 3 minutos. Entre com o Facebook que administra a empresa e tenha em mãos o celular do número, para receber o código. O link vale por ${CONNECT_LINK_DAYS} dias.`,
  ].join('\n\n')
}

export interface OpenConnectLink {
  createdAt: string
  expiresAt: string
  via: ConnectLinkVia
}

function fail(error: { code?: string } | null): never {
  if (isMissingTable(error)) throw new ConnectLinkUnavailableError()
  throw error
}

/**
 * A new link for the CRM. The CRM's open links stop working: only the
 * newest one is ever valid. Returns the plaintext token (once).
 */
export async function createConnectLink(
  admin: SupabaseClient,
  args: { accountId: string; createdBy: string; via: ConnectLinkVia; now?: Date },
): Promise<{ token: string; expiresAt: string }> {
  const now = args.now ?? new Date()
  await revokeConnectLinks(admin, args.accountId, now)

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + CONNECT_LINK_DAYS * 86_400_000).toISOString()
  const { error } = await admin.from('whatsapp_connect_links').insert({
    token_hash: hashConnectToken(token),
    account_id: args.accountId,
    created_by: args.createdBy,
    created_via: args.via,
    expires_at: expiresAt,
  })
  if (error) fail(error)
  return { token, expiresAt }
}

/** Cancel every open link of the CRM. */
export async function revokeConnectLinks(
  admin: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await admin
    .from('whatsapp_connect_links')
    .update({ revoked_at: now.toISOString() })
    .eq('account_id', accountId)
    .is('used_at', null)
    .is('revoked_at', null)
  if (error) fail(error)
}

/** The CRM's open link, if any (to show "link ativo até …"). */
export async function loadOpenConnectLink(
  admin: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<OpenConnectLink | null> {
  const { data, error } = await admin
    .from('whatsapp_connect_links')
    .select('created_at, expires_at, created_via')
    .eq('account_id', accountId)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    // Before 081 there is simply no link.
    if (isMissingTable(error)) return null
    throw error
  }
  if (!data) return null
  return {
    createdAt: data.created_at as string,
    expiresAt: data.expires_at as string,
    via: data.created_via === 'agencia' ? 'agencia' : 'crm',
  }
}

export interface UsableConnectLink {
  id: string
  accountId: string
  createdBy: string | null
  crmName: string
}

/**
 * The link a token opens, while it can still be used — or null:
 * malformed, unknown, expired, used or cancelled all read the same,
 * so the page never tells which tokens exist.
 */
export async function findUsableConnectLink(
  admin: SupabaseClient,
  token: string,
  now: Date = new Date(),
): Promise<UsableConnectLink | null> {
  if (!CONNECT_TOKEN.test(token)) return null
  const { data, error } = await admin
    .from('whatsapp_connect_links')
    .select('id, account_id, created_by, accounts(name)')
    .eq('token_hash', hashConnectToken(token))
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', now.toISOString())
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  if (!data) return null
  const account = (Array.isArray(data.accounts) ? data.accounts[0] : data.accounts) as
    | { name?: string | null }
    | null
  return {
    id: data.id as string,
    accountId: data.account_id as string,
    createdBy: (data.created_by as string | null) ?? null,
    crmName: account?.name?.trim() || 'CRM',
  }
}

/**
 * Take the link for one connection attempt. Only one request wins:
 * the update matches only while the link is still unused. Returns
 * false when someone else took it first.
 */
export async function claimConnectLink(
  admin: SupabaseClient,
  linkId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await admin
    .from('whatsapp_connect_links')
    .update({ used_at: now.toISOString() })
    .eq('id', linkId)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id')
  if (error) throw error
  return Array.isArray(data) && data.length > 0
}

/** The attempt failed before connecting: the link can be used again. */
export async function releaseConnectLink(admin: SupabaseClient, linkId: string): Promise<void> {
  const { error } = await admin
    .from('whatsapp_connect_links')
    .update({ used_at: null })
    .eq('id', linkId)
  if (error) console.error('[connect link] release failed:', error)
}
