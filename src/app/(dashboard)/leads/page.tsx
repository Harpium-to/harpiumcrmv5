"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Copy,
  FileJson,
  Loader2,
  Magnet,
  Megaphone,
  Plug,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { leadTags, normalizeLead, type LeadRoute } from "@/lib/leads/parse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LeadFieldMappings } from "@/components/leads/lead-field-mappings";
import { LeadTokens } from "@/components/leads/lead-tokens";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LeadRow {
  id: string;
  source: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  campaign: string | null;
  contact_id: string | null;
  created_at: string;
  raw: unknown;
}

/** A contact that may go with the leads being deleted (see lib/leads/delete). */
interface TestContactPreview {
  contact_id: string;
  name: string | null;
  lead_ids: string[];
}

/** The confirmation open for deleting `ids`. */
interface PendingDelete {
  ids: string[];
  /** null while the server checks which contacts are tests. */
  testContacts: TestContactPreview[] | null;
}

/** What the list shows that only the raw payload knows (tags, route). */
interface LeadView extends LeadRow {
  tags: string[];
  route: LeadRoute | null;
}

const ROUTE_CLASS: Record<LeadRoute, string> = {
  A: "bg-emerald-500/10 text-emerald-500",
  B: "bg-amber-500/10 text-amber-500",
  C: "bg-slate-500/10 text-muted-foreground",
};

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
  const [canManage, setCanManage] = useState(false);
  const [viewing, setViewing] = useState<LeadView | null>(null);
  const [reprocessing, setReprocessing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteContacts, setDeleteContacts] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const leadViews = useMemo<LeadView[] | null>(() => {
    if (!leads) return null;
    return leads.map((l) => {
      const n = normalizeLead(l.raw);
      return { ...l, tags: leadTags(n), route: n.route };
    });
  }, [leads]);

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
      setCanManage(Boolean(json.canManage));
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
      .select("id, source, full_name, email, phone, campaign, contact_id, created_at, raw")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error("Falha ao carregar leads");
      setLeads([]);
      return;
    }
    const rows = data as LeadRow[];
    setLeads(rows);
    // A lead that is gone can't stay selected.
    const present = new Set(rows.map((r) => r.id));
    setSelected((prev) => new Set([...prev].filter((id) => present.has(id))));
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

  /**
   * Run leads through today's rules again. One lead (`ids`) or every
   * stored lead, a batch at a time, following the server's cursor.
   */
  const reprocess = async (ids?: string[]) => {
    const key = ids ? ids.join(",") : "all";
    setReprocessing(key);
    let processed = 0;
    let created = 0;
    try {
      let cursor: string | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const res: Response = await fetch("/api/leads/reprocess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ids ? { ids } : { cursor }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Falha ao reprocessar");
        processed += json.processed ?? 0;
        created += json.contacts_created ?? 0;
        cursor = json.next_cursor ?? null;
        if (!cursor) break;
      }
      toast.success(
        ids
          ? "Lead reprocessado"
          : `${processed} lead(s) reprocessado(s)${created ? `, ${created} contato(s) criado(s)` : ""}`,
      );
      setViewing(null);
      void loadLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao reprocessar");
    } finally {
      setReprocessing(null);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    leads !== null && leads.length > 0 && leads.every((l) => selected.has(l.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelected(allSelected || !leads ? new Set() : new Set(leads.map((l) => l.id)));
  };

  /**
   * Open the confirmation, then ask the server which of the leads'
   * contacts are test contacts that could go with them.
   */
  const askDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleteContacts(false);
    setPendingDelete({ ids, testContacts: null });
    try {
      const res = await fetch("/api/leads/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, preview: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao preparar a exclusão");
      setPendingDelete((cur) =>
        cur && cur.ids === ids ? { ids, testContacts: json.test_contacts ?? [] } : cur,
      );
    } catch (err) {
      // Without the check, the lead can still go; the contact stays.
      setPendingDelete((cur) => (cur && cur.ids === ids ? { ids, testContacts: [] } : cur));
      toast.error(err instanceof Error ? err.message : "Falha ao preparar a exclusão");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const withContacts = deleteContacts && (pendingDelete.testContacts?.length ?? 0) > 0;
    setDeleting(true);
    try {
      const res = await fetch("/api/leads/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pendingDelete.ids, delete_contacts: withContacts }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao apagar");
      const leadsDeleted: number = json.leads_deleted ?? 0;
      const contactsDeleted: number = json.contacts_deleted ?? 0;
      const contactsFailed: number = json.contacts_failed ?? 0;
      const parts = [leadsDeleted === 1 ? "Lead apagado" : `${leadsDeleted} leads apagados`];
      if (contactsDeleted > 0) {
        parts.push(
          contactsDeleted === 1
            ? "1 contato de teste apagado"
            : `${contactsDeleted} contatos de teste apagados`,
        );
      }
      toast.success(parts.join(", "));
      if (contactsFailed > 0) {
        toast.error(
          `Não deu para apagar ${contactsFailed === 1 ? "o contato de teste" : `${contactsFailed} contatos de teste`}. Apague em Contatos.`,
        );
      }
      setPendingDelete(null);
      if (viewing && pendingDelete.ids.includes(viewing.id)) setViewing(null);
      void loadLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao apagar");
    } finally {
      setDeleting(false);
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

        <LeadTokens canManage={canManage} />

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
          <TutorialButton
            id="v1"
            label="Formato Harpium Lead v1"
            open={openTutorial}
            onToggle={setOpenTutorial}
          />
        </div>
        {openTutorial === "google" && <GoogleTutorial />}
        {openTutorial === "zapier" && <ZapierTutorial />}
        {openTutorial === "v1" && <HarpiumV1Tutorial />}
      </section>

      {leads && leads.length > 0 && (
        <LeadFieldMappings
          leads={leads}
          canManage={canManage}
          sourceLabel={(s) => SOURCE_LABEL[s] ?? s}
        />
      )}

      {/* ---- Leads list ---- */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Leads recebidos</h2>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && selected.size > 0 && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pendingDelete !== null}
                onClick={() => void askDelete([...selected])}
              >
                <Trash2 className="h-4 w-4" />
                Apagar selecionados ({selected.size})
              </Button>
            )}
            {canManage && leads && leads.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reprocessing !== null}
                onClick={() => void reprocess()}
                title="Lê de novo os dados guardados de cada lead e grava no contato o que antes ficava de fora (respostas, etiquetas, campos). Não apaga nem troca o que já está preenchido."
              >
                {reprocessing === "all" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reprocessar leads
              </Button>
            )}
          </div>
        </div>
        {leadViews === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : leadViews.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum lead recebido ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {canManage && (
                    <th className="w-10 py-3 pl-4">
                      <Checkbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Selecionar todos os leads da lista"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Campanha</th>
                  <th className="px-4 py-3 font-medium">Etiquetas</th>
                  <th className="px-4 py-3 font-medium">Rota</th>
                  <th className="px-4 py-3 font-medium">Recebido</th>
                  <th className="px-4 py-3 font-medium">Contato</th>
                  <th className="px-4 py-3 font-medium">
                    <span className="sr-only">Dados recebidos</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leadViews.map((l) => (
                  <tr key={l.id} className={selected.has(l.id) ? "bg-muted/40" : undefined}>
                    {canManage && (
                      <td className="w-10 py-3 pl-4">
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => toggleSelected(l.id)}
                          aria-label={`Selecionar o lead ${l.full_name ?? l.phone ?? l.email ?? ""}`.trim()}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className="whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {SOURCE_LABEL[l.source] ?? l.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{l.full_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {l.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.campaign ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {l.tags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex max-w-[16rem] flex-wrap gap-1">
                          {l.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {l.route ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROUTE_CLASS[l.route]}`}
                        >
                          {l.route}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatWhen(l.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {l.contact_id ? (
                        <a
                          href={`/contacts?contact=${l.contact_id}`}
                          className="text-xs text-emerald-500 hover:underline"
                        >
                          ver contato
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {l.phone || l.email ? "sem contato" : "sem telefone"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewing(l)}
                          className="whitespace-nowrap text-muted-foreground"
                        >
                          <FileJson className="h-4 w-4" />
                          Ver dados recebidos
                        </Button>
                        {canManage && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={pendingDelete !== null}
                            onClick={() => void askDelete([l.id])}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Apagar lead"
                            title="Apagar lead"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {pendingDelete && pendingDelete.ids.length > 1
                ? `Apagar ${pendingDelete.ids.length} leads?`
                : "Apagar este lead?"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              O registro e os dados recebidos saem da lista, junto com a nota que o lead
              deixou no contato. Não dá para desfazer. O contato continua no CRM.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete?.testContacts === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Conferindo os contatos…
            </p>
          ) : pendingDelete && pendingDelete.testContacts.length > 0 ? (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3">
              <Checkbox
                checked={deleteContacts}
                onCheckedChange={(v) => setDeleteContacts(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium text-popover-foreground">
                  {pendingDelete.testContacts.length === 1
                    ? `Apagar também o contato de teste${
                        pendingDelete.testContacts[0].name
                          ? ` (${pendingDelete.testContacts[0].name})`
                          : ""
                      }`
                    : `Apagar também os ${pendingDelete.testContacts.length} contatos de teste`}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Só entra aqui contato que chegou ao CRM por este lead e nunca escreveu. Vão
                  junto o card no funil, a conversa, as notas e as etiquetas dele.
                </span>
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || pendingDelete?.testContacts === null}
              onClick={() => void confirmDelete()}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Apagar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="border-border bg-popover sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Dados recebidos</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Exatamente o que chegou na URL
              {viewing ? ` em ${formatWhen(viewing.created_at)}` : ""}. Se um dado
              está aqui, ele chegou ao CRM.
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <>
              <pre className="max-h-[55vh] overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
                {viewing.raw == null
                  ? "Nenhum dado guardado para este lead."
                  : JSON.stringify(viewing.raw, null, 2)}
              </pre>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyRaw(viewing.raw)}
                >
                  <Copy className="h-4 w-4" />
                  Copiar
                </Button>
                {canManage && viewing.raw != null && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={reprocessing !== null}
                    onClick={() => void reprocess([viewing.id])}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {reprocessing === viewing.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Reprocessar este lead
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function copyRaw(raw: unknown) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(raw, null, 2));
    toast.success("Dados copiados");
  } catch {
    toast.error("Não foi possível copiar");
  }
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
          No corpo (JSON ou formulário), envie <code className="font-mono">nome</code>,{" "}
          <code className="font-mono">telefone</code>,{" "}
          <code className="font-mono">email</code> e, se quiser,{" "}
          <code className="font-mono">origem</code>,{" "}
          <code className="font-mono">campanha</code>,{" "}
          <code className="font-mono">etiquetas</code> e as{" "}
          <code className="font-mono">utm_*</code>. Qualquer outro campo também
          entra: vai para o campo personalizado de mesmo nome ou para uma nota no
          contato.
        </Step>
        <Step n={4}>
          Teste — o lead aparece aqui na lista. Em <em>Ver dados recebidos</em>{" "}
          você vê exatamente o que chegou.
        </Step>
      </ol>
    </TutorialBox>
  );
}

const V1_EXAMPLE = `{
  "versao": "1",
  "origem": "quiz-planejados",
  "id_externo": "sessao-7f3c",
  "contato": {
    "nome": "Ana",
    "telefone": "+5563999990000",
    "empresa": "Planejados Silva",
    "cidade": "Palmas",
    "uf": "TO",
    "instagram": "@planejadossilva"
  },
  "campanha": { "utm_source": "meta", "utm_campaign": "planejados-nov" },
  "qualificacao": { "rota": "A", "qualificado": true, "motivos": ["perfil completo"] },
  "etiquetas": ["quiz-planejados", "verba-baixa"],
  "respostas": [
    { "pergunta": "Faturamento mensal", "resposta": "De R$ 75 mil a R$ 150 mil" }
  ],
  "campos": { "faturamento": "75a150" },
  "consentimento": { "aceito": true, "texto": "Aceito ser contatado", "em": "2026-11-11" }
}`;

function HarpiumV1Tutorial() {
  return (
    <TutorialBox>
      <p className="font-medium text-foreground">
        Formato Harpium Lead v1 (quiz e integrações novas)
      </p>
      <p className="mt-1">
        Quem integra do zero manda direto neste formato, com{" "}
        <code className="font-mono">&quot;versao&quot;: &quot;1&quot;</code>. Precisa de
        telefone ou e-mail; o resto é opcional e nada é descartado.
      </p>
      <ul className="mt-2 space-y-1">
        <li>
          <code className="font-mono">respostas</code> e{" "}
          <code className="font-mono">nota</code> viram uma nota no contato.
        </li>
        <li>
          <code className="font-mono">etiquetas</code> e a rota (
          <code className="font-mono">rota-a</code>,{" "}
          <code className="font-mono">rota-b</code>,{" "}
          <code className="font-mono">rota-c</code>) viram etiquetas, criadas se
          não existirem.
        </li>
        <li>
          Cada chave de <code className="font-mono">campos</code> preenche o campo
          personalizado de mesmo nome; o que não existir vai para a nota.
        </li>
        <li>
          O mesmo <code className="font-mono">id_externo</code> da mesma origem em
          até 24 horas não cria outro registro.
        </li>
      </ul>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground">
        {V1_EXAMPLE}
      </pre>
      <p className="mt-3 font-medium text-foreground">Respostas da URL</p>
      <ul className="mt-1 space-y-1">
        <li>
          <strong>200</strong> lead gravado (
          <code className="font-mono">&quot;duplicado&quot;: true</code> se já tinha
          chegado)
        </li>
        <li>
          <strong>422</strong> faltou telefone e e-mail (o lead fica guardado aqui
          mesmo assim)
        </li>
        <li>
          <strong>400</strong> formato ilegível · <strong>401</strong> token errado ·{" "}
          <strong>413</strong> mais de 100 KB · <strong>429</strong> mais de 60
          envios por minuto
        </li>
      </ul>
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
