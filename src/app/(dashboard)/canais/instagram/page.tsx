"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, ArrowLeft, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DisplayHeading } from "@/components/ui/display-heading";
import { Skeleton } from "@/components/dashboard/skeleton";

interface ConfigState {
  igUserId: string;
  pageId: string;
  username: string;
  enabled: boolean;
  hasToken: boolean;
  callbackUrl: string;
  verifyTokenSet: boolean;
}

/**
 * Instagram Direct setup.
 *
 * Deliberately a credentials form rather than a "Conectar Instagram"
 * button. The OAuth version is nicer and needs a reviewed Meta app
 * with `instagram_manage_messages` — a process measured in weeks that
 * only the account owner can start. Pasting a token works the day the
 * permission is granted, which is the difference between a feature
 * that ships and one that waits.
 *
 * The steps are on the page for the same reason: this is the one setup
 * in the product that cannot be completed without leaving it.
 */
export default function InstagramChannelPage() {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [config, setConfig] = useState<ConfigState | null>(null);
  const [igUserId, setIgUserId] = useState("");
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/instagram/config");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ConfigState;
      setConfig(data);
      setIgUserId(data.igUserId);
      setPageId(data.pageId);
      setEnabled(data.enabled);
    } catch {
      toast.error("Não foi possível carregar a configuração.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/instagram/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          igUserId,
          pageId,
          enabled,
          // Only sent when newly typed, so saving to flip the switch
          // never overwrites a working token with an empty string.
          accessToken: token || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Falha ao salvar");
      setToken("");
      toast.success(
        data?.username
          ? `Conectado como @${data.username}`
          : "Configuração salva",
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link
          href="/canais"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Canais
        </Link>
        <DisplayHeading title="Instagram" subtitle="Direct" />
      </div>

      {config === null ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <section className="surface space-y-4 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-medium text-foreground">
                  <AtSign className="size-4 text-muted-foreground" />
                  {config.username ? `@${config.username}` : "Conta conectada"}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {config.hasToken
                    ? "Token salvo. Ligue o canal para começar a receber DMs."
                    : "Cole o token da Página abaixo para conectar."}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canEdit}
                aria-label="Canal ativo"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ig-user-id">ID da conta do Instagram</Label>
                <Input
                  id="ig-user-id"
                  value={igUserId}
                  onChange={(e) => setIgUserId(e.target.value)}
                  placeholder="17841400000000000"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  O número que o webhook traz como <code>entry.id</code>. Não é
                  o @ do perfil.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ig-page-id">ID da Página do Facebook</Label>
                <Input
                  id="ig-page-id"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  placeholder="opcional"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  A Página à qual a conta profissional está vinculada.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ig-token">Token de acesso da Página</Label>
              <Input
                id="ig-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  config.hasToken ? "••••••••  (deixe vazio para manter)" : ""
                }
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Guardado cifrado e nunca devolvido para a tela. Precisa das
                permissões <code>instagram_basic</code> e{" "}
                <code>instagram_manage_messages</code>.
              </p>
            </div>

            {canEdit ? (
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                Salvar
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Só administradores podem alterar este canal.
              </p>
            )}
          </section>

          <section className="surface space-y-4 rounded-2xl p-5">
            <h2 className="font-medium text-foreground">
              No painel do app da Meta
            </h2>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">1.</strong> Em Webhooks,
                adicione a inscrição <code>instagram</code> e marque o campo{" "}
                <code>messages</code>.
              </li>
              <li>
                <strong className="text-foreground">2.</strong> Use esta URL de
                callback:
                <CopyRow value={config.callbackUrl} />
              </li>
              <li>
                <strong className="text-foreground">3.</strong> O token de
                verificação é a variável de ambiente{" "}
                <code>META_INSTAGRAM_VERIFY_TOKEN</code>.{" "}
                {config.verifyTokenSet ? (
                  <span className="text-foreground">Está definida.</span>
                ) : (
                  <span className="text-destructive">
                    Ainda não está definida — a Meta vai recusar a inscrição.
                  </span>
                )}
              </li>
              <li>
                <strong className="text-foreground">4.</strong> Conecte a conta
                profissional do Instagram à Página e gere o token da Página com
                as duas permissões acima.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Fora da janela de 24 horas desde a última mensagem da pessoa, a
              Meta recusa o envio. O erro aparece no inbox com o texto que ela
              devolve.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1.5 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-foreground/8 px-2.5 py-1.5 text-xs text-foreground">
        {value || "—"}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copiar URL"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}
