import type { SupabaseClient } from '@supabase/supabase-js'

import { getEvolutionConfig, isEvolutionReady } from '@/lib/evolution/config'
import { getUazapiConfig, isUazapiReady } from '@/lib/uazapi/config'

// ============================================================
// Which WhatsApp a CRM sends through (D1).
//
// A CRM chooses a *path* (accounts.whatsapp_path, migration 059):
//
//   'oficial'      Meta Cloud API.
//   'nao_oficial'  QR code through UAZAPI. Evolution still counts as
//                  unofficial for CRMs that already run one, but it is
//                  no longer offered to clients.
//
// The *provider* is the concrete door a message leaves by. Every send
// — inbox, public API, flows, automations, agents, AI — asks
// `resolveWhatsAppProvider` first, so a feature is built once and
// works on both paths.
//
// With no path chosen (every CRM before 059, or 059 not applied yet)
// the rule is the one the inbox already used: an enabled UAZAPI
// instance wins, then Evolution, then Meta. Applying 059 changes
// nothing until somebody chooses.
//
// See docs/plano-whatsapp-dois-caminhos.md.
// ============================================================

export type WhatsAppPath = 'oficial' | 'nao_oficial'
export type WhatsAppProvider = 'meta' | 'uazapi' | 'evolution'

/**
 * Version of the risk text a person accepts to choose the unofficial
 * path. Recorded in whatsapp_path_log with every acceptance; bump it
 * whenever the wording of `WhatsAppPath.risk*` in messages/*.json
 * changes, so the log keeps saying what each person actually read.
 */
export const WHATSAPP_RISK_TERMS_VERSION = '2026-11-09'

export const NOT_CONNECTED_UNOFFICIAL =
  'O WhatsApp não oficial não está conectado. Leia o QR code em Configurações › WhatsApp.'

export interface WhatsAppRouteFacts {
  /** The stored choice. null = not chosen, or 059 not applied. */
  path: WhatsAppPath | null
  uazapiReady: boolean
  evolutionReady: boolean
}

export function isWhatsAppPath(v: unknown): v is WhatsAppPath {
  return v === 'oficial' || v === 'nao_oficial'
}

/**
 * The provider for a set of facts. Pure.
 *
 * - 'oficial' is always Meta. If Meta isn't configured, the Meta
 *   sender says so in its own words, as it always did. A UAZAPI
 *   instance left enabled from before never takes over.
 * - 'nao_oficial' is UAZAPI, or Evolution for a CRM that runs one.
 *   null when neither is ready: callers must refuse rather than fall
 *   back to Meta, which would answer from a different number.
 * - no choice: the old implicit rule.
 */
export function pickProvider(f: WhatsAppRouteFacts): WhatsAppProvider | null {
  if (f.path === 'oficial') return 'meta'
  const unofficial: WhatsAppProvider | null = f.uazapiReady
    ? 'uazapi'
    : f.evolutionReady
      ? 'evolution'
      : null
  if (f.path === 'nao_oficial') return unofficial
  return unofficial ?? 'meta'
}

/**
 * The path a CRM is effectively on, for the screens: the stored choice,
 * or — before anyone chose — what its connections imply. null when it
 * has nothing at all, which is when the choice screen shows.
 */
export function effectivePath(
  f: WhatsAppRouteFacts & { metaConfigured: boolean },
): WhatsAppPath | null {
  if (f.path) return f.path
  if (f.uazapiReady || f.evolutionReady) return 'nao_oficial'
  if (f.metaConfigured) return 'oficial'
  return null
}

/**
 * The stored path. Missing column (059 not applied) or any read error
 * reads as "not chosen", which keeps the pre-059 behaviour.
 */
export async function loadWhatsAppPath(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppPath | null> {
  try {
    const { data, error } = await db
      .from('accounts')
      .select('whatsapp_path')
      .eq('id', accountId)
      .maybeSingle()
    if (error || !data) return null
    const path = (data as { whatsapp_path?: unknown }).whatsapp_path
    return isWhatsAppPath(path) ? path : null
  } catch {
    return null
  }
}

export async function loadRouteFacts(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppRouteFacts> {
  // A failed read of a channel's config means "that channel isn't
  // ready", never a crashed send: the remaining rule still answers.
  const [path, uaz, evo] = await Promise.all([
    loadWhatsAppPath(db, accountId),
    getUazapiConfig(db, accountId).catch(() => null),
    getEvolutionConfig(db, accountId).catch(() => null),
  ])
  return {
    path,
    uazapiReady: isUazapiReady(uaz),
    evolutionReady: isEvolutionReady(evo),
  }
}

/** The door this CRM's WhatsApp messages leave by right now. */
export async function resolveWhatsAppProvider(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppProvider | null> {
  return pickProvider(await loadRouteFacts(db, accountId))
}
