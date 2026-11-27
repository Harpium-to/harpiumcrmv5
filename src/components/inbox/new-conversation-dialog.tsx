"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCan } from "@/hooks/use-can";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Suggestion {
  id: string;
  name: string | null;
  phone: string;
}

export interface StartedConversationInfo {
  conversationId: string;
  provider: string;
}

/**
 * "Nova conversa": the inbox button and its dialog. Type a number (and,
 * optionally, a name), and the conversation with it opens — created when
 * the CRM never talked to that number. While typing, contacts that match
 * show up so nobody creates a duplicate.
 */
export function NewConversationButton({
  onStarted,
}: {
  onStarted: (info: StartedConversationInfo) => void;
}) {
  const t = useTranslations("Inbox.newConversation");
  const canSend = useCan("send-messages");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Search what was typed in either field: digits against the phone,
  // letters against the name.
  const query = useMemo(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 4) return { kind: "phone" as const, value: digits };
    const n = name.trim();
    if (n.length >= 2) return { kind: "name" as const, value: n };
    return null;
  }, [phone, name]);

  useEffect(() => {
    if (!open || !query) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const supabase = createClient();
      const like = `%${query.value.replace(/[%_]/g, "")}%`;
      const { data } = await supabase
        .from("contacts")
        .select("id, name, phone")
        .ilike(query.kind === "phone" ? "phone" : "name", like)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (!cancelled) setSuggestions((data as Suggestion[] | null) ?? []);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  if (!canSend) return null;

  function reset() {
    setPhone("");
    setName("");
    setError(null);
    setSuggestions([]);
    setBusy(false);
  }

  async function start(target: { phone: string; name?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: target.phone, name: target.name ?? null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : t("failed"));
        setBusy(false);
        return;
      }
      if (body.contact_created) toast.success(t("created"));
      setOpen(false);
      reset();
      onStarted({ conversationId: body.conversation_id, provider: body.provider });
    } catch {
      setError(t("failed"));
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-9 shrink-0"
        title={t("button")}
        aria-label={t("button")}
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="size-4" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!phone.trim()) {
                setError(t("phoneRequired"));
                return;
              }
              void start({ phone, name });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nova-conversa-telefone">{t("phoneLabel")}</Label>
              <Input
                id="nova-conversa-telefone"
                inputMode="tel"
                autoComplete="off"
                autoFocus
                placeholder={t("phonePlaceholder")}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
              />
              <p className="text-xs text-muted-foreground">{t("phoneHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nova-conversa-nome">{t("nameLabel")}</Label>
              <Input
                id="nova-conversa-nome"
                autoComplete="off"
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {query && suggestions.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("existing")}</p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void start({ phone: s.phone })}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                          busy && "opacity-60",
                        )}
                      >
                        <UserRound className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{s.name || s.phone}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{s.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("opening") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
