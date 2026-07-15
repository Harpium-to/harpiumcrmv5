"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Magnet, Save } from "lucide-react";

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
  form_name: string | null;
  contact_id: string | null;
  created_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  other: "Outro",
};

export default function LeadsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [googleKey, setGoogleKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);

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

  const loadLeads = useCallback(async () => {
    const db = createClient();
    const { data, error } = await db
      .from("leads")
      .select(
        "id, source, full_name, email, phone, campaign, form_name, contact_id, created_at",
      )
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
    void loadLeads();
  }, [loadConfig, loadLeads]);

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

      {/* Config */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div>
          <Label className="text-muted-foreground">URL de recebimento (webhook)</Label>
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
              placeholder="opcional — a “Key” que você define no Google Ads"
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

        <div className="grid gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">Google Ads</p>
            <p className="mt-0.5">
              No formulário de lead, em “Webhook integration”, cole a URL acima
              e informe a mesma Chave do Google definida aqui.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Meta (Facebook / Instagram)</p>
            <p className="mt-0.5">
              Conecte seu Lead Ad a esta URL via Zapier/Make (ação “Webhook →
              POST”), enviando nome, email e telefone. Integração nativa da Meta
              virá em seguida.
            </p>
          </div>
        </div>
      </div>

      {/* Leads list */}
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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
