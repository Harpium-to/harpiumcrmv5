"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Copy,
  Loader2,
  Magnet,
  Megaphone,
  Plug,
  Save,
  Trash2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LeadRow {
  id: string;
  source: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  campaign: string | null;
  contact_id: string | null;
  created_at: string;
}

interface MetaPage {
  id: string;
  page_id: string;
  page_name: string | null;
  subscribed: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  other: "Outro",
};

const META_ERROR: Record<string, string> = {
  config: "Meta não configurado no servidor (falta META_APP_ID). Veja o tutorial.",
  forbidden: "Apenas administradores podem conectar o Facebook.",
  state: "Falha de segurança na conexão. Tente novamente.",
  denied: "Conexão cancelada.",
  no_pages: "Nenhuma Página encontrada na sua conta do Facebook.",
  exchange: "Falha ao conectar com a Meta. Tente novamente.",
};

export default function LeadsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [googleKey, setGoogleKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [metaPages, setMetaPages] = useState<MetaPage[]>([]);
  const [metaConfigured, setMetaConfigured] = useState(false);
  const [openTutorial, setOpenTutorial] = useState<string | null>(null);

  const ingestUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/api/leads/ingest/${token}`
      : "";

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/config");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar config");
      setToken(json.token);
      setGoogleKey(json.googleKey ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar config");
    }
  }, []);

  const loadMetaPages = useCallback(async () => {
    try {
      const res = await fetch("/api/leads/meta-pages");
      const json = await res.json();
      if (res.ok) {
        setMetaPages(json.pages ?? []);
        setMetaConfigured(Boolean(json.configured));
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadLeads = useCallback(async () => {
    const db = createClient();
    const { data, error } = await db
      .from("leads")
      .select("id, source, full_name, email, phone, campaign, contact_id, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error("Falha ao carregar leads");
      setLeads([]);
      return;
    }
    setLeads(data as LeadRow[]);
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadMetaPages();
    void loadLeads();
  }, [loadConfig, loadMetaPages, loadLeads]);

  // Surface the OAuth return, then clean the query string.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get("meta_connected");
    const err = p.get("meta_error");
    if (connected) {
      toast.success(`${connected} página(s) do Facebook conectada(s).`);
      void loadMetaPages();
    } else if (err) {
      toast.error(META_ERROR[err] ?? "Falha na conexão com a Meta.");
    }
    if (connected || err) {
      window.history.replaceState({}, "", "/leads");
    }
  }, [loadMetaPages]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(ingestUrl);
      toast.success("URL copiada");
    } catch {
      toast.error("Não foi possível copiar — copie manualmente");
    }
  };

  const saveKey = async () => {
    setSavingKey(true);
    try {
      const res = await fetch("/api/leads/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      toast.success("Chave do Google salva");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingKey(false);
    }
  };

  const disconnectPage = async (id: string) => {
    try {
      const res = await fetch(`/api/leads/meta-pages?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Falha ao desconectar");
      }
      toast.success("Página desconectada");
      void loadMetaPages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Magnet className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Receba leads das suas campanhas do Meta e do Google direto no CRM.
          </p>
        </div>
      </div>

      {/* ---- Meta (native) ---- */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold text-foreground">
                Meta (Facebook / Instagram) — nativo
              </h2>
              <p className="text-sm text-muted-foreground">
                Conecte suas Páginas e receba os Lead Ads automaticamente.
              </p>
            </div>
          </div>
          <TutorialButton
            id="meta"
            open={openTutorial}
            onToggle={setOpenTutorial}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href="/api/meta/oauth/start">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Megaphone className="h-4 w-4" />
              Conectar Facebook
            </Button>
          </a>
          {!metaConfigured && (
            <span className="text-xs text-amber-500">
              Configuração do servidor pendente — veja o tutorial.
            </span>
          )}
        </div>

        {metaPages.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {metaPages.map((pg) => (
              <li
                key={pg.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{pg.page_name ?? pg.page_id}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      pg.subscribed
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-amber-500/10 text-amber-500"
                    }`}
                  >
                    {pg.subscribed ? "recebendo" : "não inscrito"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnectPage(pg.id)}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {openTutorial === "meta" && <MetaTutorial />}
      </section>

      {/* ---- Receiving URL: Google (direct) + generic ---- */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold text-foreground">
                URL de recebimento (Google Ads e outras)
              </h2>
              <p className="text-sm text-muted-foreground">
                O Google Ads envia direto para esta URL. Zapier/Make e outros
                formulários também podem usá-la.
              </p>
            </div>
          </div>
        </div>

        <div>
          <Label className="text-muted-foreground">URL (webhook)</Label>
          <div className="mt-1 flex gap-2">
            <Input
              readOnly
              value={ingestUrl}
              placeholder="Carregando…"
              className="border-border bg-muted font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={copyUrl}
              disabled={!ingestUrl}
              className="shrink-0"
            >
              <Copy className="h-4 w-4" />
              Copiar
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Mantenha em segredo — quem tiver essa URL pode enviar leads para a
            sua conta.
          </p>
        </div>

        <div className="max-w-md">
          <Label htmlFor="gkey" className="text-muted-foreground">
            Chave do Google (Google Lead Form)
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="gkey"
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              placeholder="a “Key” que você define no Google Ads"
              className="border-border bg-muted"
            />
            <Button
              type="button"
              onClick={saveKey}
              disabled={savingKey}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <TutorialButton
            id="google"
            label="Tutorial Google Ads"
            open={openTutorial}
            onToggle={setOpenTutorial}
          />
          <TutorialButton
            id="zapier"
            label="Tutorial Zapier / Make"
            open={openTutorial}
            onToggle={setOpenTutorial}
          />
        </div>
        {openTutorial === "google" && <GoogleTutorial />}
        {openTutorial === "zapier" && <ZapierTutorial />}
      </section>

      {/* ---- Leads list ---- */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Leads recebidos
        </h2>
        {leads === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum lead recebido ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Campanha</th>
                  <th className="px-4 py-3 font-medium">Recebido</th>
                  <th className="px-4 py-3 font-medium">Contato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {SOURCE_LABEL[l.source] ?? l.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{l.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.campaign ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatWhen(l.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {l.contact_id ? (
                        <span className="text-xs text-emerald-500">criado</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          sem telefone
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TutorialButton({
  id,
  label = "Tutorial",
  open,
  onToggle,
}: {
  id: string;
  label?: string;
  open: string | null;
  onToggle: (v: string | null) => void;
}) {
  const isOpen = open === id;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onToggle(isOpen ? null : id)}
      className="shrink-0"
    >
      <BookOpen className="h-4 w-4" />
      {isOpen ? "Fechar tutorial" : label}
    </Button>
  );
}

function TutorialBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function MetaTutorial() {
  return (
    <TutorialBox>
      <p className="font-medium text-foreground">
        Conectar Lead Ads da Meta (nativo)
      </p>
      <p className="mt-1">
        Suas próprias Páginas funcionam em modo de desenvolvimento (sem App
        Review). Para Páginas de clientes, a Meta exige App Review da permissão{" "}
        <code className="font-mono">leads_retrieval</code> + verificação de
        negócio.
      </p>
      <p className="mt-3 font-medium text-foreground">No servidor (.env)</p>
      <ol className="mt-1 space-y-1">
        <Step n={1}>
          Defina <code className="font-mono">META_APP_ID</code> (o mesmo app
          Meta do WhatsApp serve).
        </Step>
        <Step n={2}>
          Defina <code className="font-mono">META_LEADS_VERIFY_TOKEN</code> (um
          texto secreto que você escolhe).
        </Step>
      </ol>
      <p className="mt-3 font-medium text-foreground">No painel da Meta</p>
      <ol className="mt-1 space-y-1">
        <Step n={3}>
          Em <em>Facebook Login → Settings</em>, adicione o Valid OAuth Redirect
          URI: <code className="font-mono">&lt;seu-domínio&gt;/api/meta/oauth/callback</code>.
        </Step>
        <Step n={4}>
          Em <em>Webhooks → Page</em>, callback URL{" "}
          <code className="font-mono">&lt;seu-domínio&gt;/api/meta/leads/webhook</code>,
          verify token igual ao do .env, e assine o campo{" "}
          <code className="font-mono">leadgen</code>.
        </Step>
        <Step n={5}>
          Volte aqui e clique <strong>Conectar Facebook</strong> — escolha as
          Páginas. Pronto: os leads chegam sozinhos.
        </Step>
      </ol>
    </TutorialBox>
  );
}

function GoogleTutorial() {
  return (
    <TutorialBox>
      <p className="font-medium text-foreground">Google Ads (direto, sem intermediário)</p>
      <ol className="mt-2 space-y-1">
        <Step n={1}>Defina uma “Key” aqui em cima e clique Salvar.</Step>
        <Step n={2}>
          No Google Ads, abra o formulário de lead → <em>Webhook integration</em>.
        </Step>
        <Step n={3}>
          Em <em>Webhook URL</em> cole a URL de recebimento acima; em{" "}
          <em>Key</em> cole a mesma Key.
        </Step>
        <Step n={4}>
          Clique <em>Send test data</em> — deve aparecer um lead de teste aqui na
          lista.
        </Step>
      </ol>
    </TutorialBox>
  );
}

function ZapierTutorial() {
  return (
    <TutorialBox>
      <p className="font-medium text-foreground">
        Zapier / Make (indireto — para Meta sem App Review ou qualquer form)
      </p>
      <ol className="mt-2 space-y-1">
        <Step n={1}>
          Gatilho: “New Lead” do Facebook Lead Ads (ou seu formulário).
        </Step>
        <Step n={2}>
          Ação: <em>Webhooks → POST</em> para a URL de recebimento acima.
        </Step>
        <Step n={3}>
          No corpo (JSON), envie <code className="font-mono">nome</code>,{" "}
          <code className="font-mono">telefone</code>,{" "}
          <code className="font-mono">email</code> e, se quiser,{" "}
          <code className="font-mono">source</code>/
          <code className="font-mono">campanha</code>.
        </Step>
        <Step n={4}>Teste — o lead aparece aqui na lista.</Step>
      </ol>
    </TutorialBox>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
