import Link from "next/link";
// This lucide build dropped the brand marks (trademark), so the
// Instagram card wears the generic social-handle glyph.
import {
  AtSign,
  MessageCircle,
  QrCode,
  ServerCog,
  type LucideIcon,
} from "lucide-react";

import { DisplayHeading } from "@/components/ui/display-heading";
import { loadAgencia } from "@/lib/agencia/guard";
import { getCurrentAccount } from "@/lib/auth/account";
import { getEvolutionConfig } from "@/lib/evolution/config";
import { getUazapiConfig } from "@/lib/uazapi/config";
import { hostedUazapi, isHostedBaseUrl } from "@/lib/uazapi/hosted";

// Channel hub.
//
// Grouped rather than listed, because the groups carry a warning that
// does not apply to all of them. The page used to say "ambos são
// canais não oficiais… risco de banimento", which was true when both
// cards were unofficial WhatsApp bridges. Instagram Direct is Meta's
// own API, and leaving that sentence under it would attach a ban
// warning to the one channel that cannot get you banned — the kind of
// copy drift that makes people ignore the real warning.
//
// Since D1 a client's WhatsApp — official or unofficial — is chosen
// and connected in Settings › WhatsApp. The UAZAPI-with-own-server and
// Evolution cards are manual setups: shown to the agency, and to a CRM
// that already has one, so nobody loses the screen of a channel they
// run.

interface ChannelCard {
  href: string;
  icon: LucideIcon;
  title: string;
  blurb: string;
  badge: string;
}

const WHATSAPP: ChannelCard = {
  href: "/settings?tab=whatsapp",
  icon: MessageCircle,
  title: "WhatsApp",
  blurb:
    "Oficial, pela API da Meta, ou não oficial, por QR code. Você escolhe o caminho e conecta o número em Configurações.",
  badge: "Oficial ou QR code",
};

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

const MANUAL: ChannelCard[] = [
  {
    href: "/canais/uazapi",
    icon: QrCode,
    title: "UAZAPI com servidor próprio",
    blurb:
      "Para um servidor UAZAPI que não é o da Harpium. Exige colar o endereço e o token; o pareamento continua por QR code.",
    badge: "Configuração manual",
  },
  {
    href: "/canais/evolution",
    icon: ServerCog,
    title: "WhatsApp via Evolution API",
    blurb:
      "Para quem já roda uma instância Evolution própria. Envia só texto. Exige colar a URL, o nome da instância e a API key.",
    badge: "Instância própria",
  },
];

/** The agency, or a CRM that already runs a manual setup. */
async function showManualSetup(): Promise<boolean> {
  try {
    const gate = await loadAgencia();
    if (gate.status === "ok") return true;
    const ctx = await getCurrentAccount();
    const [evo, uaz] = await Promise.all([
      getEvolutionConfig(ctx.supabase, ctx.accountId),
      getUazapiConfig(ctx.supabase, ctx.accountId),
    ]);
    return (
      Boolean(evo?.base_url) ||
      (Boolean(uaz?.base_url) && !isHostedBaseUrl(uaz?.base_url, hostedUazapi()))
    );
  } catch {
    return false;
  }
}

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

export default async function CanaisPage() {
  const manual = await showManualSetup();
  return (
    <div className="space-y-8">
      <DisplayHeading title="Canais" subtitle="por onde você fala" />

      <section className="space-y-3">
        <p className="eyebrow">WhatsApp e Instagram</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card channel={WHATSAPP} />
          {OFFICIAL.map((c) => (
            <Card key={c.href} channel={c} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          O caminho não oficial do WhatsApp conecta por QR code e{" "}
          <strong className="text-foreground">
            pode levar ao bloqueio do número
          </strong>
          . A tela de Configurações explica a diferença antes de você
          escolher.
        </p>
      </section>

      {manual && (
        <section className="space-y-3">
          <p className="eyebrow">Configuração manual · agência</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {MANUAL.map((c) => (
              <Card key={c.href} channel={c} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Os dois conectam por QR code e{" "}
            <strong className="text-foreground">
              violam os termos da Meta — há risco de banimento do número
            </strong>
            , principalmente em disparos em massa.
          </p>
        </section>
      )}
    </div>
  );
}
