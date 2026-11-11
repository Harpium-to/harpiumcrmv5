import type { Metadata } from "next";

import { PublicBooking } from "@/components/agenda/public-booking";

// A booking link is handed to customers one by one; it has no business
// in a search engine's index.
export const metadata: Metadata = {
  title: "Agendar horário",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The public booking page (migration 067, Fase 4): a customer opens
 * the link an agenda's admin shared, picks a free slot and leaves a
 * name and a WhatsApp number. No login — see lib/agenda/public.ts for
 * what the link can and cannot do.
 */
export default async function MarcarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicBooking token={token} />;
}
