import { handleLeadIngest } from '@/lib/leads/receive'

// Public lead-ingest webhook. The `token` in the path identifies the
// account (there is no session). Accepts Harpium Lead v1, Google Lead
// Form, Meta Lead Ads and generic JSON or form bodies — see
// src/lib/leads/receive.ts for the answers it gives and
// docs/recebimento-universal-de-leads.md for the format.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  return handleLeadIngest(request, token)
}
