"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ImageUp, Loader2, MessageSquare, Save } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AgenciaMarcaPage() {
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const db = createClient();
    const { data } = await db
      .from("app_branding")
      .select("name, logo_url")
      .maybeSingle();
    if (data) {
      setName(data.name ?? "");
      setLogoUrl(data.logo_url ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const db = createClient();
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
      const path = `logo-${Date.now()}.${ext}`;
      const { error } = await db.storage
        .from("branding")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (error) throw error;
      const { data } = db.storage.from("branding").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast.success("Logo enviada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar a logo");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/agencia/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, logoUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      toast.success("Marca salva. Recarregue para ver na barra lateral.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link
          href="/agencia"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Todas as contas
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Marca do sistema</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nome e logo exibidos no topo para todos os usuários. Só a agência edita.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          {/* Preview */}
          <div>
            <Label className="text-muted-foreground">Prévia</Label>
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt="logo"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
              </div>
              <span className="text-sm font-semibold">
                {name || "Modelo de CRM para WhatsApp"}
              </span>
            </div>
          </div>

          <div>
            <Label htmlFor="brand-name" className="text-muted-foreground">
              Nome do CRM
            </Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Harpium CRM"
              className="mt-1 border-border bg-muted"
            />
          </div>

          <div>
            <Label className="text-muted-foreground">Logo</Label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageUp className="h-4 w-4" />
                )}
                Enviar imagem
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  className="hidden"
                  onChange={onPickLogo}
                  disabled={uploading}
                />
              </label>
              {logoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLogoUrl(null)}
                  className="text-muted-foreground hover:text-red-400"
                >
                  Remover logo
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPG, WebP, SVG ou GIF. Até 5 MB.
            </p>
          </div>

          <Button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar marca
          </Button>
        </div>
      )}
    </div>
  );
}
