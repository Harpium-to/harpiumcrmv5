import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadRouteFacts,
  pickProvider,
  type WhatsAppPath,
  type WhatsAppProvider,
} from '@/lib/channels/whatsapp-route';
import { getUazapiStatus } from '@/lib/uazapi/api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

// ============================================================
// Which WhatsApp number a message sent through the CRM leaves from
// (Fase 4B of docs/plano-extensao-chrome.md).
//
// The Chrome extension offers "Enviar pelo CRM" only when the number
// logged in to WhatsApp Web is this one. Otherwise the customer would
// get the message from a number other than the one on their screen.
//
// The number is always read from the provider, never from a cache:
// a cached number that is out of date is exactly the case this exists
// to catch. When it can't be read, `phone` is null and the extension
// does not offer to send.
// ============================================================

export interface WhatsAppSender {
  /** The door a send would use now; null when none is connected. */
  provider: WhatsAppProvider | null;
  /** The path the CRM chose (migration 061); null when not chosen. */
  path: WhatsAppPath | null;
  /** The sending number, digits only, with country code; null when unknown. */
  phone: string | null;
}

/** What the lookup needs from outside, swappable in tests. */
export interface SenderDeps {
  loadRouteFacts: typeof loadRouteFacts;
  verifyPhoneNumber: typeof verifyPhoneNumber;
  getUazapiStatus: typeof getUazapiStatus;
  decrypt: typeof decrypt;
}

const defaultDeps: SenderDeps = { loadRouteFacts, verifyPhoneNumber, getUazapiStatus, decrypt };

/**
 * A phone number as digits, or null when it isn't one.
 *
 * Takes what the providers hand back: Meta's display number
 * ("+55 63 9228-6787") and a WhatsApp id user part that may carry a
 * device or server ("556392286787:12@s.whatsapp.net").
 */
export function senderDigits(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const user = raw.split(/[:@]/)[0];
  const digits = user.replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

async function metaPhone(
  db: SupabaseClient,
  accountId: string,
  deps: SenderDeps
): Promise<string | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle();
  const row = data as { phone_number_id: string | null; access_token: string | null } | null;
  if (!row?.phone_number_id || !row.access_token) return null;
  const info = await deps.verifyPhoneNumber({
    phoneNumberId: row.phone_number_id,
    accessToken: deps.decrypt(row.access_token),
  });
  return senderDigits(info?.display_phone_number);
}

async function uazapiPhone(
  db: SupabaseClient,
  accountId: string,
  deps: SenderDeps
): Promise<string | null> {
  const { data } = await db
    .from('uazapi_config')
    .select('base_url, instance_token')
    .eq('account_id', accountId)
    .maybeSingle();
  const row = data as { base_url: string | null; instance_token: string | null } | null;
  if (!row?.base_url || !row.instance_token) return null;
  const live = await deps.getUazapiStatus({
    baseUrl: row.base_url,
    token: deps.decrypt(row.instance_token),
  });
  // A number that isn't connected right now sends nothing.
  return live.connected ? senderDigits(live.phone) : null;
}

/**
 * The provider a send would use now and the number it sends from.
 *
 * Never throws for the provider's sake: a provider that refuses or is
 * down reads as "number unknown", which keeps sending off in the
 * extension. Evolution has no way to tell its number here, so it is
 * always unknown.
 */
export async function getWhatsAppSender(
  db: SupabaseClient,
  accountId: string,
  deps: SenderDeps = defaultDeps
): Promise<WhatsAppSender> {
  const facts = await deps.loadRouteFacts(db, accountId);
  const provider = pickProvider(facts);

  let phone: string | null = null;
  try {
    if (provider === 'meta') phone = await metaPhone(db, accountId, deps);
    else if (provider === 'uazapi') phone = await uazapiPhone(db, accountId, deps);
  } catch {
    phone = null;
  }

  return { provider, path: facts.path, phone };
}
