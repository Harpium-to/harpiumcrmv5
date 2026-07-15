import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the lead-ingest path. The public
// ingest webhook has no `auth.uid()`, so it reads the account config and
// writes leads/contacts through the service role. Mirrors
// src/lib/ai/admin-client.ts and src/lib/automations/admin-client.ts.
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
