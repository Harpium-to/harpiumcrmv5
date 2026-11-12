import { handleLeadIngest } from '@/lib/leads/receive'

// Same webhook as /api/leads/ingest/<token>, for senders that keep the
// token out of the URL: `Authorization: Bearer <token>`.
export async function POST(request: Request) {
  return handleLeadIngest(request, null)
}
