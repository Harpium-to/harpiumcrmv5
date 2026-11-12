"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ListChecks } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Filled fields shown before "show all". */
const COLLAPSED = 6;

interface FilledField {
  id: string;
  name: string;
  value: string;
}

/**
 * The contact's filled custom fields, read-only: what a lead answered
 * (lib/leads/fields.ts) and what the team typed. Shown next to the
 * conversation and on the deal, so whoever picks the contact up sees it
 * without opening the contact. Editing stays on the contact's "Campos"
 * tab. Renders nothing while loading or when no field is filled.
 */
export function ContactFieldsSummary({
  contactId,
  className,
}: {
  contactId: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations("Contacts.fieldsSummary");
  // Keyed by contact, so switching contacts never shows the last one's
  // fields and nothing has to be reset from inside the effect.
  const [loaded, setLoaded] = useState<{ contactId: string; fields: FilledField[] } | null>(null);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!contactId) return;
    void (async () => {
      const supabase = createClient();
      const [defsRes, valuesRes] = await Promise.all([
        supabase
          .from("custom_fields")
          .select("id, field_name")
          .order("created_at", { ascending: true }),
        supabase
          .from("contact_custom_values")
          .select("custom_field_id, value")
          .eq("contact_id", contactId),
      ]);
      if (cancelled) return;
      const value = new Map<string, string>();
      for (const v of (valuesRes.data ?? []) as { custom_field_id: string; value: string | null }[]) {
        const text = (v.value ?? "").trim();
        if (text) value.set(v.custom_field_id, text);
      }
      setLoaded({
        contactId,
        fields: ((defsRes.data ?? []) as { id: string; field_name: string }[])
          .filter((f) => value.has(f.id))
          .map((f) => ({ id: f.id, name: f.field_name, value: value.get(f.id)! })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const fields = contactId && loaded?.contactId === contactId ? loaded.fields : null;
  if (!fields || fields.length === 0) return null;
  const expanded = expandedFor === contactId;
  const shown = expanded ? fields : fields.slice(0, COLLAPSED);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <ListChecks className="h-3 w-3" />
        {t("title")}
      </div>
      <dl className="space-y-1.5 px-1">
        {shown.map((f) => (
          <div key={f.id}>
            <dt className="text-[11px] text-muted-foreground">{f.name}</dt>
            <dd className="whitespace-pre-wrap break-words text-sm text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>
      {fields.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpandedFor(expanded ? null : contactId ?? null)}
          className="px-1 text-xs text-primary hover:underline"
        >
          {expanded ? t("showLess") : t("showAll", { count: fields.length })}
        </button>
      )}
    </div>
  );
}
