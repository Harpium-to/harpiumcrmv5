import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { supabaseAdmin } from "@/lib/whatsapp/admin-client";
import { findUsableConnectLink } from "@/lib/whatsapp/connect-links";
import { getEmbeddedSignupSettings } from "@/lib/whatsapp/embedded-signup";
import { ConnectWhatsAppByLink } from "./connect-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conectar WhatsApp",
  robots: { index: false, follow: false, nocache: true },
  // The token is in the path: never send it to other sites.
  referrer: "no-referrer",
};

/**
 * What the person who runs the company's Facebook opens from the link
 * an admin or the agency sent (Fase A, migration 081). No login: it
 * shows which CRM it is for and connects that CRM's official WhatsApp.
 */
export default async function ConectarWhatsAppPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = supabaseAdmin();
  const link = await findUsableConnectLink(admin, token).catch(() => null);
  const settings = getEmbeddedSignupSettings();

  if (!link || !settings) {
    return (
      <Shell>
        <span className="flex size-11 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <CircleAlert className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">
          {link ? "Conexão indisponível no momento" : "Este link não vale mais"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {link
            ? "A conexão pelo Facebook não está ativa agora. Avise quem mandou o link."
            : "O link de conexão expira em 7 dias, serve para uma conexão só e para de funcionar quando um novo é gerado. Peça um link novo para quem enviou."}
        </p>
      </Shell>
    );
  }

  const { data: config } = await admin
    .from("whatsapp_config")
    .select("status")
    .eq("account_id", link.accountId)
    .maybeSingle();

  return (
    <Shell>
      <ConnectWhatsAppByLink
        token={token}
        crmName={link.crmName}
        alreadyConnected={config?.status === "connected"}
        appId={settings.appId}
        configId={settings.configId}
        graphVersion={settings.graphVersion}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="surface flex w-full max-w-md flex-col items-center gap-3 rounded-3xl px-6 py-10 text-center">
        {children}
      </div>
    </main>
  );
}
