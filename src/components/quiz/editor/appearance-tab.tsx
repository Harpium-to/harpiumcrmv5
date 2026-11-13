"use client";

// ============================================================
// Aparência: the brand on the quiz (logo, name, accent colour) and
// the small texts around the last form. The layout itself is fixed —
// every quiz comes out looking right without design work.
// ============================================================

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2, Palette, ShieldCheck, X } from "lucide-react";

import { uploadAccountMedia } from "@/lib/storage/upload-media";
import { DEFAULT_ACCENT } from "@/lib/quiz/validate";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Field, FormRow, Section, type TabProps } from "./ui";

const SWATCHES = [DEFAULT_ACCENT, "#2563eb", "#7c3aed", "#e11d48", "#f59e0b", "#16a34a", "#111318"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function AppearanceTab({ draft, update, canEdit }: TabProps) {
  const { appearance, settings } = draft;
  const [hex, setHex] = useState(appearance.accent);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const setAppearance = (patch: Partial<typeof appearance>) =>
    update((d) => ({ ...d, appearance: { ...d.appearance, ...patch } }));
  const setSettings = (patch: Partial<typeof settings>) =>
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  const pickColor = (value: string) => {
    setHex(value);
    if (HEX.test(value)) setAppearance({ accent: value.toLowerCase() });
  };

  const upload = async (chosen: File | undefined) => {
    if (!chosen) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(chosen.type)) {
      return toast.error("Use uma imagem PNG, JPG ou WebP.");
    }
    if (chosen.size > LOGO_MAX_BYTES) return toast.error("A imagem pode ter no máximo 2 MB.");
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia("chat-media", chosen);
      setAppearance({ logoUrl: publicUrl });
      toast.success("Logo enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não consegui enviar a imagem");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="grid gap-4">
      <Section
        icon={Palette}
        title="Marca"
        hint="O layout do quiz é fixo, para sair bonito sem trabalho. Aqui entram a sua marca e a sua cor."
      >
        <FormRow
          title="Logo"
          hint="PNG, JPG ou WebP, de fundo transparente ou claro, até 2 MB. O quiz é sempre claro."
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-16 w-40 items-center justify-center rounded-xl border border-border bg-white px-3">
              {appearance.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={appearance.logoUrl} alt="Logo do quiz" className="max-h-9 max-w-full object-contain" />
              ) : (
                <span className="text-xs text-neutral-400">sem logo</span>
              )}
            </span>
            {canEdit ? (
              <>
                <input
                  ref={file}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
                <Button type="button" variant="outline" disabled={uploading} onClick={() => file.current?.click()}>
                  {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
                  Enviar imagem
                </Button>
                {appearance.logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remover o logo"
                    onClick={() => setAppearance({ logoUrl: undefined })}
                  >
                    <X />
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </FormRow>

        <FormRow title="Nome da marca" hint="Aparece no topo quando não há logo. Vazio, vale o nome deste CRM.">
          <Input
            aria-label="Nome da marca"
            value={appearance.brandName ?? ""}
            disabled={!canEdit}
            maxLength={60}
            placeholder="ex.: Planejados Silva"
            className="max-w-sm"
            onChange={(e) => setAppearance({ brandName: e.target.value || undefined })}
          />
        </FormRow>

        <FormRow
          title="Cor de destaque"
          hint="Na barra de progresso, na opção escolhida e no círculo dos botões. O texto sobre ela fica escuro ou branco sozinho."
        >
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                disabled={!canEdit}
                aria-label={`Usar a cor ${color}`}
                aria-pressed={appearance.accent === color}
                onClick={() => pickColor(color)}
                style={{ backgroundColor: color }}
                className={cn(
                  "size-8 rounded-full border border-foreground/15 outline-offset-2 disabled:opacity-50",
                  appearance.accent === color && "outline-2 outline-foreground",
                )}
              />
            ))}
            <input
              type="color"
              value={appearance.accent}
              disabled={!canEdit}
              aria-label="Escolher outra cor"
              onChange={(e) => pickColor(e.target.value)}
              className="size-8 cursor-pointer rounded-full border border-border bg-transparent p-0.5"
            />
            <Input
              aria-label="Código da cor"
              value={hex}
              disabled={!canEdit}
              maxLength={7}
              aria-invalid={HEX.test(hex) ? undefined : true}
              onChange={(e) => pickColor(e.target.value.trim())}
              className="w-28 font-mono"
            />
          </div>
        </FormRow>
      </Section>

      <Section
        icon={ShieldCheck}
        title="Textos de apoio e LGPD"
        hint="Aparecem na última tela de campos, onde a pessoa deixa o contato."
      >
        <FormRow title="Frase ao lado do botão">
          <Input
            aria-label="Frase ao lado do botão"
            value={settings.privacyNote ?? ""}
            disabled={!canEdit}
            maxLength={200}
            placeholder="ex.: Seus dados ficam só com a gente. Nada de spam."
            onChange={(e) => setSettings({ privacyNote: e.target.value || undefined })}
          />
        </FormRow>
        <FormRow title="Botão enquanto envia">
          <Input
            aria-label="Texto do botão enquanto envia"
            value={settings.submittingText ?? ""}
            disabled={!canEdit}
            maxLength={80}
            placeholder="ex.: Montando seu resultado…"
            className="max-w-sm"
            onChange={(e) => setSettings({ submittingText: e.target.value || undefined })}
          />
        </FormRow>
        <FormRow
          title="Consentimento"
          hint="Fica acima do botão. Quando preenchido, o aceite e a hora vão junto com o lead."
        >
          <Textarea
            aria-label="Texto de consentimento"
            value={settings.consentText ?? ""}
            disabled={!canEdit}
            maxLength={300}
            rows={2}
            placeholder="ex.: Ao enviar, você concorda em receber o contato da nossa equipe pelo WhatsApp."
            onChange={(e) => setSettings({ consentText: e.target.value || undefined })}
          />
          <Field label="Link da política de privacidade" htmlFor="quiz-privacy-url">
            <Input
              id="quiz-privacy-url"
              value={settings.privacyUrl ?? ""}
              disabled={!canEdit}
              maxLength={500}
              inputMode="url"
              placeholder="https://…"
              onChange={(e) => setSettings({ privacyUrl: e.target.value.trim() || undefined })}
            />
          </Field>
        </FormRow>
      </Section>
    </div>
  );
}
