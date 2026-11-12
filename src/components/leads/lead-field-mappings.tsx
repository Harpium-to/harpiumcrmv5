"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2, Save } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { foldKey, normalizeLead } from "@/lib/leads/parse";
import { Button } from "@/components/ui/button";

interface LeadLike {
  source: string;
  raw: unknown;
}

interface CustomField {
  id: string;
  field_name: string;
}

const CONTACT_COLUMNS: [string, string][] = [
  ["name", "Nome"],
  ["email", "E-mail"],
  ["company", "Empresa"],
  ["city", "Cidade"],
  ["instagram", "Instagram"],
  ["website", "Site"],
  ["job_title", "Cargo"],
  ["segment", "Segmento"],
];

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none";

/**
 * The "de/para" per origin: for each extra field an origin sends, choose
 * where it goes. Without a choice, the field fills the custom field with
 * the same name, or goes to the contact's note.
 */
export function LeadFieldMappings({
  leads,
  canManage,
  sourceLabel,
}: {
  leads: LeadLike[];
  canManage: boolean;
  sourceLabel: (source: string) => string;
}) {
  // Origins that sent extra fields, and the keys each one sent (with a sample).
  const byOrigin = useMemo(() => {
    const map = new Map<string, Map<string, { key: string; sample: string }>>();
    for (const l of leads) {
      const n = normalizeLead(l.raw);
      const source = n.source === "other" && l.source ? l.source : n.source;
      for (const [key, value] of Object.entries(n.fields)) {
        const folded = foldKey(key);
        if (!folded) continue;
        let keys = map.get(source);
        if (!keys) map.set(source, (keys = new Map()));
        if (!keys.has(folded)) keys.set(folded, { key, sample: value });
      }
    }
    return map;
  }, [leads]);

  const origins = useMemo(() => Array.from(byOrigin.keys()).sort(), [byOrigin]);
  const [origin, setOrigin] = useState<string>("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = origin || origins[0] || "";

  useEffect(() => {
    void (async () => {
      const { data } = await createClient()
        .from("custom_fields")
        .select("id, field_name")
        .order("field_name");
      setCustomFields((data ?? []) as CustomField[]);
    })();
  }, []);

  const load = useCallback(async (source: string) => {
    if (!source) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/mappings?source=${encodeURIComponent(source)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar o de/para");
      setAvailable(json.available !== false);
      setSaved(json.mappings ?? {});
      setDraft(json.mappings ?? {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar o de/para");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(current);
  }, [current, load]);

  const fieldByFold = useMemo(() => {
    const m = new Map<string, CustomField>();
    for (const f of customFields) m.set(foldKey(f.field_name), f);
    return m;
  }, [customFields]);

  const keys = Array.from(byOrigin.get(current)?.entries() ?? []);
  const dirty = keys.some(([k]) => (draft[k] ?? "") !== (saved[k] ?? ""));

  const save = async () => {
    setSaving(true);
    try {
      const mappings: Record<string, string | null> = {};
      for (const [k] of keys) {
        if ((draft[k] ?? "") !== (saved[k] ?? "")) mappings[k] = draft[k] || null;
      }
      const res = await fetch("/api/leads/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: current, mappings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      toast.success("De/para salvo. Vale para os próximos leads (e para Reprocessar).");
      void load(current);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold text-foreground">De/para por origem</h2>
          <p className="text-sm text-muted-foreground">
            Escolha onde cai cada campo extra que uma origem envia. Sem escolha, ele preenche
            o campo personalizado de mesmo nome ou vai para a nota do contato. Perguntas e
            respostas sempre vão para a nota.
          </p>
        </div>
      </div>

      {origins.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Assim que chegar um lead com campos extras, eles aparecem aqui.
        </p>
      ) : !available ? (
        <p className="text-xs text-amber-500">
          Disponível depois que a migration 068 for aplicada no banco. Até lá, vale a regra
          automática (campo de mesmo nome, senão nota).
        </p>
      ) : (
        <>
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Origem</label>
            <select value={current} onChange={(e) => setOrigin(e.target.value)} className={SELECT_CLASS}>
              {origins.map((o) => (
                <option key={o} value={o}>
                  {sourceLabel(o)}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Campo recebido</th>
                    <th className="py-2 pr-4 font-medium">Exemplo</th>
                    <th className="py-2 font-medium">Vai para</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {keys.map(([folded, { key, sample }]) => {
                    const auto = fieldByFold.get(folded);
                    return (
                      <tr key={folded}>
                        <td className="py-2 pr-4 font-mono text-xs">{key}</td>
                        <td className="max-w-[14rem] truncate py-2 pr-4 text-muted-foreground" title={sample}>
                          {sample}
                        </td>
                        <td className="min-w-[14rem] py-2">
                          <select
                            value={draft[folded] ?? ""}
                            disabled={!canManage}
                            onChange={(e) => setDraft((d) => ({ ...d, [folded]: e.target.value }))}
                            className={SELECT_CLASS}
                          >
                            <option value="">
                              Automático ({auto ? `campo ${auto.field_name}` : "nota"})
                            </option>
                            <option value="note">Nota do contato</option>
                            <option value="ignore">Ignorar</option>
                            <optgroup label="Contato">
                              {CONTACT_COLUMNS.map(([col, label]) => (
                                <option key={col} value={`contact:${col}`}>
                                  {label}
                                </option>
                              ))}
                            </optgroup>
                            {customFields.length > 0 && (
                              <optgroup label="Campos personalizados">
                                {customFields.map((f) => (
                                  <option key={f.id} value={`custom:${f.id}`}>
                                    {f.field_name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canManage && (
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar de/para
            </Button>
          )}
        </>
      )}
    </section>
  );
}
