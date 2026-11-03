import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the agency super-vision path.
// Mirrors src/lib/ai/admin-client.ts and src/lib/automations/admin-client.ts.
//
// The /agencia console lets a verified agency operator read and manage
// EVERY account (client). Account-scoped RLS (migration 017) would hide
// all of it from a normal session, so — once membership is confirmed by
// `requireAgencia()` — the console queries through this service-role
// client, which bypasses RLS. Never expose this client to a route that
// hasn't passed the agency gate.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
