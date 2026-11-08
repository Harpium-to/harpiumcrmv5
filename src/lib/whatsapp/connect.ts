import type { SupabaseClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from './meta-api'
import { encrypt } from './encryption'

// ============================================================
// Save a WhatsApp Cloud API connection for an account.
//
// One path for both ways in: the manual form (the operator pastes
// the ids, token and PIN) and Embedded Signup (Meta hands us the ids
// and token, we derive the PIN). Keeping a single implementation is
// what guarantees both end in the same state — registered,
// subscribed, token encrypted, one row per account.
// ============================================================

export interface SaveConnectionArgs {
  /** RLS-scoped client: reads and writes the caller's own row. */
  db: SupabaseClient
  /** Service-role client: needed to see a number claimed by ANOTHER
   *  account, which RLS hides from the caller. */
  admin: SupabaseClient
  accountId: string
  /** Audit column: which member saved the config. */
  userId: string
  phoneNumberId: string
  wabaId: string | null
  accessToken: string
  /** Manual form only. Embedded Signup relies on the app-wide token. */
  verifyToken?: string | null
  /** 6-digit two-step PIN. Optional on the manual form (Meta test
   *  numbers have none); always present for Embedded Signup. */
  pin?: string | null
  /**
   * How the number was connected. Embedded Signup always says; the
   * manual form leaves it out and the row keeps the mode it had.
   *   'cloud'       — Cloud API only: /register with the PIN.
   *   'coexistence' — the number stays on the WhatsApp Business app on
   *                   the phone. Meta registers it during the popup and
   *                   /register must NOT be called (it would take the
   *                   number off the app), so the PIN is ignored.
   */
  connectionMode?: ConnectionMode
}

export type ConnectionMode = 'cloud' | 'coexistence'

/** Sync bookkeeping that belongs to one coexistence onboarding. */
const SYNC_RESET = {
  history_sync_status: null,
  history_sync_progress: null,
  history_sync_requested_at: null,
  history_sync_finished_at: null,
  history_sync_error: null,
  contacts_sync_requested_at: null,
  contacts_synced_at: null,
} as const

export type SaveConnectionResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      phoneInfo: MetaPhoneInfo
      /** The number is registered for this app's webhooks. */
      registered: boolean
      /** No PIN was given, so /register was deliberately not tried. */
      registrationSkipped: boolean
      /** /register was tried and Meta refused it. */
      registrationError: string | null
      connectionMode: ConnectionMode
    }

export async function saveWhatsAppConnection(
  args: SaveConnectionArgs,
): Promise<SaveConnectionResult> {
  const { db, admin, accountId, userId, phoneNumberId, wabaId, accessToken } =
    args
  const verifyToken = args.verifyToken || null
  const pin = args.pin || null

  if (pin !== null && !/^\d{6}$/.test(pin)) {
    return { ok: false, status: 400, error: 'O PIN precisa ter exatamente 6 dígitos.' }
  }

  // One number, one account. Letting two accounts bind the same number
  // makes the webhook's single-row lookup throw and silently drop every
  // inbound message (issue #136).
  const { data: claimed, error: claimedError } = await admin
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()
  if (claimedError) {
    console.error('Error checking phone_number_id ownership:', claimedError)
    return { ok: false, status: 500, error: 'Falha ao validar a configuração' }
  }
  if (claimed) {
    return {
      ok: false,
      status: 409,
      error:
        'Este número de WhatsApp já está ligado a outra conta deste sistema. Cada número só pode estar conectado a uma conta.',
    }
  }

  // Verify the credentials with Meta BEFORE saving anything.
  let phoneInfo: MetaPhoneInfo
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido na API da Meta'
    console.error('Meta API verification failed during save:', message)
    return { ok: false, status: 400, error: `Erro na API da Meta: ${message}` }
  }

  let encryptedAccessToken: string
  let encryptedVerifyToken: string | null
  try {
    encryptedAccessToken = encrypt(accessToken)
    encryptedVerifyToken = verifyToken ? encrypt(verifyToken) : null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido de criptografia'
    console.error('Encryption failed:', message)
    return {
      ok: false,
      status: 500,
      error:
        'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
    }
  }

  // Is this number already registered for this account? Then a save
  // without a fresh PIN (say, rotating the token) must not re-register:
  // a stale PIN would fail and undo the working subscription.
  const { data: existing } = await db
    .from('whatsapp_config')
    .select('id, registered_at, phone_number_id, verify_token, connection_mode')
    .eq('account_id', accountId)
    .maybeSingle()

  const sameNumber =
    existing?.phone_number_id === phoneNumberId && existing?.registered_at != null
  const mode: ConnectionMode =
    args.connectionMode ??
    (existing?.phone_number_id === phoneNumberId && existing?.connection_mode === 'coexistence'
      ? 'coexistence'
      : 'cloud')

  let registeredAt: string | null = sameNumber ? existing?.registered_at ?? null : null
  let registrationError: string | null = null
  let registrationSkipped = false

  const needsRegistration = mode === 'cloud' && (!sameNumber || pin !== null)
  if (mode === 'coexistence') {
    // Meta registered the number when the business confirmed it in the
    // WhatsApp Business app; it's live as soon as the popup closes.
    registeredAt = registeredAt ?? new Date().toISOString()
  } else if (needsRegistration) {
    if (!pin) {
      // Meta TEST numbers come pre-registered and have no PIN to give,
      // so requiring one made them impossible to connect (issue #242).
      // Save as connected and let the UI offer "add a PIN" later.
      registrationSkipped = true
    } else {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin })
        registeredAt = new Date().toISOString()
      } catch (err) {
        registrationError =
          err instanceof Error ? err.message : 'Erro desconhecido na API da Meta'
        console.error('Phone number /register failed:', registrationError)
        // Still save, so the operator can retry with a PIN without
        // redoing everything; the UI shows WHY it isn't live.
      }
    }
  }

  // Subscribe the WABA to this app. Idempotent on Meta's side, so it
  // runs on every save.
  let subscribedAppsAt: string | null = null
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('WABA subscribed_apps failed (non-fatal):', message)
    }
  }

  const now = new Date().toISOString()
  const baseRow = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId || null,
    access_token: encryptedAccessToken,
    // A blank verify token on re-save means "keep it", not "clear it" —
    // clearing would break the next webhook verification.
    verify_token: encryptedVerifyToken ?? existing?.verify_token ?? null,
    status: registrationError ? 'disconnected' : 'connected',
    connected_at: registrationError ? null : now,
    registered_at: registrationError ? null : registeredAt,
    subscribed_apps_at: subscribedAppsAt,
    last_registration_error: registrationError,
    updated_at: now,
    // A fresh connection clears whatever Meta said when it last cut it.
    connection_mode: mode,
    status_reason: null,
    status_changed_at: now,
    // A different number (or mode) starts a new onboarding; the import
    // state of the previous one would only confuse the status screen.
    ...(existing &&
    existing.phone_number_id === phoneNumberId &&
    existing.connection_mode === mode
      ? {}
      : SYNC_RESET),
  }

  if (existing) {
    const { error } = await db
      .from('whatsapp_config')
      .update(baseRow)
      .eq('account_id', accountId)
    if (error) {
      console.error('Error updating whatsapp_config:', error)
      return { ok: false, status: 500, error: 'Falha ao atualizar a configuração' }
    }
  } else {
    const { error } = await db
      .from('whatsapp_config')
      .insert({ account_id: accountId, user_id: userId, ...baseRow })
    if (error) {
      console.error('Error inserting whatsapp_config:', error)
      return { ok: false, status: 500, error: 'Falha ao salvar a configuração' }
    }
  }

  return {
    ok: true,
    phoneInfo,
    registered: registeredAt != null && !registrationError,
    registrationSkipped,
    registrationError,
    connectionMode: mode,
  }
}
