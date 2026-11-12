"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Video,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsPanelHead } from "./settings-panel-head";
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from "@/components/interactive/interactive-builder";
import {
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from "@/lib/whatsapp/interactive";
import {
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from "@/lib/storage/upload-media";
import {
  mediaKindForMime,
  QUICK_REPLY_CAPTION_MAX,
  QUICK_REPLY_MEDIA_ACCEPT,
  QUICK_REPLY_MEDIA_BUCKET,
  QUICK_REPLY_MEDIA_LABELS,
  type QuickReplyMediaKind,
} from "@/lib/quick-replies/media";
import type { QuickReply, QuickReplyKind } from "@/types";

interface DraftMedia {
  kind: QuickReplyMediaKind;
  url: string;
  path: string;
  filename: string | null;
}

export interface DraftState {
  id?: string;
  title: string;
  kind: QuickReplyKind;
  content_text: string;
  interactive_payload: InteractiveMessagePayload;
  media: DraftMedia | null;
  /**
   * A file uploaded in this dialog and not saved yet. Removed from
   * storage if the dialog closes without saving, or another file
   * replaces it. A file already saved is never removed from here:
   * messages sent with it point to the same URL.
   */
  unsavedPath: string | null;
}

function emptyDraft(): DraftState {
  return {
    title: "",
    kind: "text",
    content_text: "",
    interactive_payload: blankButtonsPayload(),
    media: null,
    unsavedPath: null,
  };
}

function discardUpload(path: string | null) {
  if (!path) return;
  void deleteAccountMedia(QUICK_REPLY_MEDIA_BUCKET, path).catch(() => {});
}

const MEDIA_ICONS: Record<QuickReplyMediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  audio: Mic,
};

export function QuickRepliesManager() {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quick-replies", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.quick_replies as QuickReply[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (qr: QuickReply) =>
    setDraft({
      id: qr.id,
      title: qr.title,
      kind: qr.kind,
      content_text: qr.content_text ?? "",
      interactive_payload:
        qr.interactive_payload ?? blankButtonsPayload(),
      media:
        qr.kind === "media" && qr.media_kind && qr.media_url && qr.media_path
          ? {
              kind: qr.media_kind,
              url: qr.media_url,
              path: qr.media_path,
              filename: qr.media_filename ?? null,
            }
          : null,
      unsavedPath: null,
    });

  // Closing without saving: a file uploaded just now goes away.
  const closeDialog = useCallback(() => {
    setDraft((current) => {
      discardUpload(current?.unsavedPath ?? null);
      return null;
    });
  }, []);

  const pickFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !draft) return;
      const kind = mediaKindForMime(file.type);
      if (!kind) {
        toast.error("Esse tipo de arquivo não vai pelo WhatsApp. Veja os tipos aceitos abaixo.");
        return;
      }
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          `${QUICK_REPLY_MEDIA_LABELS[kind]} de até ${Math.round(max / 1024 / 1024)} MB. Este tem ${(
            file.size / 1024 / 1024
          ).toFixed(1)} MB.`,
        );
        return;
      }
      setUploading(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(QUICK_REPLY_MEDIA_BUCKET, file);
        setDraft((current) => {
          if (!current) {
            discardUpload(path);
            return current;
          }
          discardUpload(current.unsavedPath);
          return {
            ...current,
            media: { kind, url: publicUrl, path, filename: file.name },
            unsavedPath: path,
          };
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Não consegui enviar o arquivo.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [draft],
  );

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error("Dê um nome à resposta rápida.");
      return;
    }
    if (draft.kind === "media" && !draft.media) {
      toast.error("Escolha o arquivo da resposta rápida.");
      return;
    }
    const payload =
      draft.kind === "interactive"
        ? { title: draft.title, kind: "interactive", interactive_payload: draft.interactive_payload }
        : draft.kind === "media" && draft.media
          ? {
              title: draft.title,
              kind: "media",
              media_kind: draft.media.kind,
              media_url: draft.media.url,
              media_path: draft.media.path,
              media_filename: draft.media.filename,
              content_text: draft.media.kind === "audio" ? "" : draft.content_text,
            }
          : { title: draft.title, kind: "text", content_text: draft.content_text };

    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/quick-replies/${draft.id}` : "/api/quick-replies",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Não consegui salvar a resposta rápida.");
        return;
      }
      toast.success(draft.id ? "Resposta rápida atualizada." : "Resposta rápida criada.");
      // Saved: the file now belongs to the reply — unless it was saved
      // as another kind, and then nothing uses it.
      if (draft.kind !== "media") discardUpload(draft.unsavedPath);
      setDraft(null);
      await load();
    } catch {
      toast.error("Não consegui salvar a resposta rápida.");
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("Excluir esta resposta rápida?")) return;
      const res = await fetch(`/api/quick-replies/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Não consegui excluir a resposta rápida.");
        return;
      }
      await load();
    },
    [load],
  );

  return (
    <div>
      <SettingsPanelHead
        title="Respostas rápidas"
        description="Trechos reutilizáveis — texto, uma foto, vídeo, áudio ou documento, ou uma mensagem interativa salva — que a equipe usa no campo de mensagem do inbox. Os de texto e os com mídia também aparecem na extensão do Chrome, dentro do WhatsApp Web."
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Nova resposta rápida
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nenhuma resposta rápida ainda. Crie uma para reaproveitar nas conversas.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((qr) => (
            <li
              key={qr.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              <QuickReplyIcon qr={qr} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{qr.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {qr.kind === "interactive" && qr.interactive_payload
                    ? interactivePayloadPreviewText(qr.interactive_payload)
                    : qr.kind === "media" && qr.media_kind
                      ? [
                          QUICK_REPLY_MEDIA_LABELS[qr.media_kind],
                          qr.content_text || qr.media_filename,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : qr.content_text}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(qr)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(qr.id)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar resposta rápida" : "Nova resposta rápida"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Nome</label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="ex.: Horário de atendimento"
                  className="bg-muted text-foreground"
                />
              </div>
              <div className="flex gap-2">
                <KindTab
                  active={draft.kind === "text"}
                  label="Texto"
                  onClick={() => setDraft({ ...draft, kind: "text" })}
                />
                <KindTab
                  active={draft.kind === "media"}
                  label="Mídia"
                  onClick={() => setDraft({ ...draft, kind: "media" })}
                />
                <KindTab
                  active={draft.kind === "interactive"}
                  label="Interativa"
                  onClick={() => setDraft({ ...draft, kind: "interactive" })}
                />
              </div>
              {draft.kind === "media" ? (
                <MediaFields
                  draft={draft}
                  uploading={uploading}
                  inputRef={fileInputRef}
                  onPick={(file) => void pickFile(file)}
                  onCaption={(text) => setDraft({ ...draft, content_text: text })}
                />
              ) : draft.kind === "text" ? (
                <>
                  <Textarea
                    value={draft.content_text}
                    onChange={(e) => setDraft({ ...draft, content_text: e.target.value })}
                    placeholder="O texto da mensagem a inserir"
                    className="min-h-28 bg-muted text-foreground"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Para preencher com os dados do contato, escreva{" "}
                    <code>{"{{nome}}"}</code>, <code>{"{{primeiro_nome}}"}</code> ou{" "}
                    <code>{"{{empresa}}"}</code>. Vale no inbox e na extensão do Chrome.
                  </p>
                </>
              ) : (
                <InteractiveBuilder
                  value={draft.interactive_payload}
                  onChange={(p) => setDraft({ ...draft, interactive_payload: p })}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving || uploading}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KindTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
          : "flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}

function QuickReplyIcon({ qr }: { qr: QuickReply }) {
  if (qr.kind === "interactive") return <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />;
  if (qr.kind === "media" && qr.media_kind) {
    const Icon = MEDIA_ICONS[qr.media_kind];
    return <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />;
  }
  return <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

/** The file of a media reply: pick it, see it, and its caption. */
export function MediaFields({
  draft,
  uploading,
  inputRef,
  onPick,
  onCaption,
}: {
  draft: DraftState;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | undefined) => void;
  onCaption: (text: string) => void;
}) {
  const media = draft.media;
  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={QUICK_REPLY_MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      {media ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          {media.kind === "image" ? (
            // A preview of the user's own upload; next/image would need
            // the storage host configured for a few pixels of gain.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt="" className="max-h-56 rounded-md object-contain" />
          ) : media.kind === "video" ? (
            <video src={media.url} controls className="max-h-56 rounded-md" />
          ) : media.kind === "audio" ? (
            <audio src={media.url} controls className="w-full" />
          ) : (
            <p className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{media.filename ?? "Documento"}</span>
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {QUICK_REPLY_MEDIA_LABELS[media.kind]}
              {media.filename ? ` · ${media.filename}` : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Trocar arquivo
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="mr-1 h-4 w-4" />
          )}
          {uploading ? "Enviando o arquivo…" : "Escolher arquivo"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Foto (JPG, PNG ou WebP, até 5 MB), vídeo (MP4), áudio (OGG, MP3, M4A, AAC ou AMR) ou
        documento (PDF, Word, Excel, PowerPoint ou TXT), até 16 MB.
      </p>
      {media?.kind === "audio" ? (
        <p className="text-xs text-muted-foreground">O áudio vai sem legenda.</p>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Legenda (opcional)</label>
          <Textarea
            value={draft.content_text}
            onChange={(e) => onCaption(e.target.value)}
            maxLength={QUICK_REPLY_CAPTION_MAX}
            placeholder="O texto que vai junto com o arquivo"
            className="min-h-20 bg-muted text-foreground"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Aceita <code>{"{{nome}}"}</code>, <code>{"{{primeiro_nome}}"}</code> e{" "}
            <code>{"{{empresa}}"}</code>.
          </p>
        </div>
      )}
    </div>
  );
}
