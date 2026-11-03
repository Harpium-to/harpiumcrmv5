import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Server-only read of the global white-label brand (name + logo), used by
// the root layout to set the browser tab title and favicon. Uses the
// service role so it resolves even on unauthenticated pages (login), and
// never throws — a missing table (migration 041 not applied) or any error
// falls back to the product defaults.

let _client: SupabaseClient | null = null

function admin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _client
}

export interface GlobalBranding {
  name: string | null
  logoUrl: string | null
}

export async function getGlobalBranding(): Promise<GlobalBranding> {
  try {
    const { data } = await admin()
      .from('app_branding')
      .select('name, logo_url')
      .maybeSingle()
    return { name: data?.name ?? null, logoUrl: data?.logo_url ?? null }
  } catch {
    return { name: null, logoUrl: null }
  }
}
