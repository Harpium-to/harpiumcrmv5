import Link from "next/link";
// This lucide build dropped the brand marks (trademark), so the
// Instagram card wears the generic social-handle glyph.
import { AtSign, QrCode, ServerCog, type LucideIcon } from "lucide-react";

import { DisplayHeading } from "@/components/ui/display-heading";

// Channel hub.
//
// Grouped rather than listed, because the groups carry a warning that
// does not apply to all of them. The page used to say "ambos são
// canais não oficiais… risco de banimento", which was true when both
// cards were unofficial WhatsApp bridges. Instagram Direct is Meta's
// own API, and leaving that sentence under it would attach a ban
// warning to the one channel that cannot get you banned — the kind of
// copy drift that makes people ignore the real warning.

interface ChannelCard {
  href: string;
  icon: LucideIcon;
  title: string;
  blurb: string;
  badge: string;
}

const UNOFFICIAL: ChannelCard[] = [
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
];

const OFFICIAL: ChannelCard[] = [
  {
    href: "/canais/instagram",
    icon: AtSign,
    title: "Instagram Direct",
    blurb:
      "DMs da sua conta profissional caem no mesmo inbox, atendidas pelas mesmas pessoas e pelos mesmos agentes.",
    badge: "API oficial da Meta",
  },
];

function Card({ channel }: { channel: ChannelCard }) {
  const Icon = channel.icon;
  return (
    <Link
      href={channel.href}
      className="surface group rounded-2xl p-5 transition-colors hover:bg-foreground/8"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <span className="rounded-full bg-foreground/8 px-2.5 py-1 text-xs text-muted-foreground">
          {channel.badge}
        </span>
      </div>
      <h3 className="mt-3 font-medium text-foreground">{channel.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{channel.blurb}</p>
    </Link>
  );
}

export default function CanaisPage() {
  return (
    <div className="space-y-8">
      <DisplayHeading title="Canais" subtitle="por onde você fala" />

      <section className="space-y-3">
        <p className="eyebrow">Oficiais</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {OFFICIAL.map((c) => (
            <Card key={c.href} channel={c} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A API oficial de WhatsApp da Meta fica em Configurações — é o
          caminho padrão, não um canal alternativo.
        </p>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">Não oficiais</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {UNOFFICIAL.map((c) => (
            <Card key={c.href} channel={c} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Os dois conectam por QR code e{" "}
          <strong className="text-foreground">
            violam os termos da Meta — há risco de banimento do número
          </strong>
          , principalmente em disparos em massa. Quando um deles está ativo,
          os envios de texto do inbox saem por ele.
        </p>
      </section>
    </div>
  );
}
