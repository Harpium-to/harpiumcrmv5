import type { Metadata } from "next";
import { CalendarCheck, CircleAlert } from "lucide-react";

import { professionalResultMessage } from "@/lib/google/oauth-flow";

export const metadata: Metadata = {
  title: "Google Agenda",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where a professional lands after connecting their Google Agenda from
 * the link an admin sent (G3). No login: it only says how it went.
 */
export default async function ConectarGoogleProntoPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
  const message = professionalResultMessage(google ?? null);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="surface flex w-full max-w-md flex-col items-center gap-3 rounded-3xl px-6 py-10 text-center">
        <span
          className={`flex size-11 items-center justify-center rounded-full ${
            message.ok ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-600"
          }`}
        >
          {message.ok ? <CalendarCheck className="size-5" /> : <CircleAlert className="size-5" />}
        </span>
        <h1 className="text-lg font-semibold">{message.title}</h1>
        <p className="text-sm text-muted-foreground">{message.text}</p>
      </div>
    </main>
  );
}
