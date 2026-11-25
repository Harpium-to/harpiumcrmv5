"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { CheckCircle2, CircleAlert, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModeOption } from "@/components/settings/whatsapp-connect";
import type { ConnectionMode } from "@/lib/whatsapp/connect";
import {
  embeddedSignupExtras,
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
} from "@/lib/whatsapp/embedded-signup-client";

type Step =
  | { kind: "choose" }
  | { kind: "popup" }
  | { kind: "finishing" }
  | { kind: "done"; name: string; coexistence: boolean; attention: boolean }
  | { kind: "gone"; message: string };

/**
 * The "Conectar com o Facebook" step of the link without login. Same
 * popup and same choice of mode as Settings › WhatsApp; the result is
 * posted to /api/conectar-whatsapp/<token>.
 */
export function ConnectWhatsAppByLink({
  token,
  crmName,
  alreadyConnected,
  appId,
  configId,
  graphVersion,
}: {
  token: string;
  crmName: string;
  alreadyConnected: boolean;
  appId: string;
  configId: string;
  graphVersion: string;
}) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [mode, setMode] = useState<ConnectionMode>("coexistence");
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceOk, setReplaceOk] = useState(!alreadyConnected);
  const sessionRef = useRef<{
    wabaId?: string;
    phoneNumberId?: string;
    businessId?: string;
    event?: string;
  }>({});
  const requestedModeRef = useRef<ConnectionMode>("coexistence");

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFacebookOrigin(event.origin)) return;
      const parsed = parseEmbeddedSignupMessage(event.data);
      if (!parsed) return;
      if (parsed.kind === "finish") {
        sessionRef.current = {
          wabaId: parsed.wabaId,
          phoneNumberId: parsed.phoneNumberId,
          businessId: parsed.businessId,
          event: parsed.event,
        };
      } else if (parsed.kind === "error" && parsed.message) {
        setError(`O Facebook avisou: ${parsed.message}`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const initSdk = useCallback(() => {
    if (!window.FB) return;
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
    setSdkReady(true);
  }, [appId, graphVersion]);

  async function finish(code: string) {
    setStep({ kind: "finishing" });
    try {
      const session = sessionRef.current;
      const res = await fetch(`/api/conectar-whatsapp/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          waba_id: session.wabaId ?? null,
          phone_number_id: session.phoneNumberId ?? null,
          business_id: session.businessId ?? null,
          mode: requestedModeRef.current,
          event: session.event ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 410) {
        setStep({ kind: "gone", message: data.error ?? "Este link não vale mais." });
        return;
      }
      if (!res.ok) {
        setError(data.error || "Não foi possível conectar. Tente de novo.");
        setStep({ kind: "choose" });
        return;
      }
      setStep({
        kind: "done",
        name: data.phone_info?.verified_name || data.phone_info?.display_phone_number || "",
        coexistence: data.connection_mode === "coexistence",
        attention: Boolean(data.registration_error),
      });
    } catch {
      setError("Não foi possível conectar. Confira a internet e tente de novo.");
      setStep({ kind: "choose" });
    }
  }

  function connect() {
    if (!window.FB || !sdkReady) return;
    setError(null);
    sessionRef.current = {};
    requestedModeRef.current = mode;
    setStep({ kind: "popup" });
    // The SDK rejects async callbacks, so this stays a plain function.
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setStep({ kind: "choose" });
          setError("A janela do Facebook foi fechada antes de terminar.");
          return;
        }
        // Give the session-info message a moment to land.
        window.setTimeout(() => void finish(code), 800);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: embeddedSignupExtras(mode),
      },
    );
  }

  if (step.kind === "done") {
    return (
      <>
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">WhatsApp conectado ao CRM {crmName}</h1>
        <p className="text-sm text-muted-foreground">
          {step.attention
            ? "A conexão foi salva, mas a Meta ainda pediu um ajuste. Avise a equipe do CRM: ela resolve em Configurações › WhatsApp."
            : step.coexistence
              ? `${step.name ? `${step.name} já está ligado. ` : ""}Pode continuar usando o WhatsApp Business no celular: as conversas aparecem também no CRM, e as antigas chegam aos poucos.`
              : `${step.name ? `${step.name} já está ligado. ` : ""}As mensagens desse número agora chegam no CRM.`}
        </p>
        <p className="text-xs text-muted-foreground">Pode fechar esta página.</p>
      </>
    );
  }

  if (step.kind === "gone") {
    return (
      <>
        <span className="flex size-11 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <CircleAlert className="size-5" />
        </span>
        <h1 className="text-lg font-semibold">Este link não vale mais</h1>
        <p className="text-sm text-muted-foreground">{step.message}</p>
      </>
    );
  }

  const busy = step.kind === "popup" || step.kind === "finishing";

  return (
    <>
      <Script
        src="https://connect.facebook.net/pt_BR/sdk.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onReady={initSdk}
        onError={() => setSdkFailed(true)}
      />
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MessageCircle className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">Conectar o WhatsApp ao CRM {crmName}</h1>
      <p className="text-sm text-muted-foreground">
        Entre com o Facebook que administra a empresa e escolha o número. Este link só serve para
        ligar o WhatsApp: ele não dá acesso a conversas nem a contatos.
      </p>

      {alreadyConnected && (
        <label className="flex w-full items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-500/10 p-3 text-left text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={replaceOk}
            onChange={(e) => setReplaceOk(e.target.checked)}
          />
          <span>
            Este CRM já tem um WhatsApp conectado. Entendo que, ao conectar, o número atual será
            trocado pelo que eu escolher.
          </span>
        </label>
      )}

      <div role="radiogroup" aria-label="Qual número" className="grid w-full gap-2 text-left">
        <p className="text-sm font-medium text-foreground">Qual número vai usar?</p>
        <ModeOption
          selected={mode === "coexistence"}
          onSelect={() => setMode("coexistence")}
          title="O número que já está no WhatsApp Business do celular"
          badge="Mais comum"
          description="Continua usando o app no celular. As conversas aparecem também no CRM."
        />
        <ModeOption
          selected={mode === "cloud"}
          onSelect={() => setMode("cloud")}
          title="Um número novo, só para o CRM"
          description="Um número que não está em nenhum WhatsApp agora. Ele passa a funcionar só pelo CRM."
        />
      </div>

      <Button className="w-full" onClick={connect} disabled={!sdkReady || busy || !replaceOk}>
        {step.kind === "popup" ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Conclua na janela do Facebook…
          </>
        ) : step.kind === "finishing" ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Ligando o número…
          </>
        ) : !sdkReady && !sdkFailed ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Carregando o Facebook…
          </>
        ) : (
          "Conectar com o Facebook"
        )}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {sdkFailed && (
        <p className="text-sm text-destructive">
          O Facebook não carregou. Desative bloqueadores de anúncio para esta página e recarregue.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Leva uns 3 minutos. Tenha em mãos o celular do número para receber o código.
      </p>
    </>
  );
}
