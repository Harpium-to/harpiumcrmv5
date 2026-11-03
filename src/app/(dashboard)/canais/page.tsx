import Link from "next/link";
import { Plug, QrCode, ServerCog } from "lucide-react";

// Channel hub. Until UAZAPI landed this route *was* the Evolution form;
// with two unofficial channels a chooser reads better than a page that
// silently means one of them. Each card links to its own setup page.
//
// The official Meta Cloud API is deliberately absent: it is configured
// under Settings, not here, because it is the default path rather than
// an alternative channel.

const CHANNELS = [
  {
    href: "/canais/uazapi",
    icon: QrCode,
    title: "WhatsApp via UAZAPI",
    blurb:
      "Conecte o número lendo um QR code aqui mesmo, sem copiar credenciais. O webhook é configurado automaticamente.",
    badge: "Pareia pelo app",
  },
  {
    href: "/canais/evolution",
    icon: ServerCog,
    title: "WhatsApp via Evolution API",
    blurb:
      "Para quem já roda uma instância Evolution própria. Exige colar a URL, o nome da instância e a API key.",
    badge: "Instância própria",
  },
] as const;

export default function CanaisPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Plug className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Canais</h1>
          <p className="text-sm text-muted-foreground">
            Canais alternativos de WhatsApp, ao lado da API oficial da Meta.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CHANNELS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <c.icon className="h-5 w-5 text-primary" />
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {c.badge}
              </span>
            </div>
            <h2 className="mt-3 font-semibold text-foreground group-hover:text-primary">
              {c.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{c.blurb}</p>
          </Link>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Ambos são canais não oficiais, que conectam por QR code e{" "}
        <strong>violam os termos da Meta — há risco de banimento do número</strong>,
        principalmente em disparos em massa. Quando um deles está ativo, os
        envios de texto do inbox saem por ele.
      </p>
    </div>
  );
}
