"use client";

// Small building blocks shared by the tabs of the quiz editor.

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { cleanTag } from "@/lib/quiz/validate";
import type { QuizDefinition } from "@/lib/quiz/types";

import { Input } from "@/components/ui/input";

/** How a tab changes the draft: hand back the next definition. */
export type DraftUpdater = (change: (draft: QuizDefinition) => QuizDefinition) => void;

/** What the phone preview beside the editor is showing. */
export type PreviewTarget =
  | { kind: "intro" }
  | { kind: "step"; id: string }
  | { kind: "result"; id: string }
  /** The whole quiz, played from the start (nothing is sent). */
  | { kind: "run" };

export interface TabProps {
  draft: QuizDefinition;
  update: DraftUpdater;
  /** False for who may only look (not an admin). */
  canEdit: boolean;
}

export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface rounded-3xl p-5 sm:p-6", className)}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          {hint ? (
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A native select in the CRM's input style. */
export function SelectBox({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        {...props}
        className="h-9 w-full appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

/**
 * Tags typed as text, separated by commas. The text is kept as typed
 * while the field has focus and tidied (lowercase, no accents,
 * hyphens) when it is left.
 */
export function TagsInput({
  value,
  onChange,
  disabled,
  placeholder,
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const [text, setText] = useState(value.join(", "));
  const joined = value.join(", ");
  useEffect(() => {
    setText(joined);
  }, [joined]);

  return (
    <Input
      id={id}
      value={text}
      disabled={disabled}
      placeholder={placeholder ?? "ex.: quiz-planejados, anuncio"}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const tags = [...new Set(text.split(",").map(cleanTag).filter(Boolean))];
        onChange(tags);
        setText(tags.join(", "));
      }}
    />
  );
}

/** A card that opens to show its editor; one open at a time is the caller's job. */
export function Collapsible({
  open,
  onToggle,
  header,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border transition-colors",
        open ? "border-primary/50 bg-foreground/[0.02]" : "border-border",
        className,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
      >
        {header}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </div>
      {open ? <div className="space-y-4 border-t border-border px-3 py-4 sm:px-4">{children}</div> : null}
    </div>
  );
}
