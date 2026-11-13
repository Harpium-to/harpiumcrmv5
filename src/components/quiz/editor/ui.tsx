"use client";

// ============================================================
// The visual vocabulary of the quiz editor.
//
// Each kind of thing has a look of its own, so the eye tells them
// apart before reading:
//
//   screens   a colour and an icon per type — entry (violet), choice
//             question (sky), fields (emerald), message (amber) and the
//             result at the end (the CRM's primary colour);
//   results   the colour of their route: qualified green, warm amber,
//             not a fit grey;
//   logic     conditions read as sentences, joined by "E" / "OU";
//   settings  a row per setting: what it is on the left, the control on
//             the right (FormRow), grouped in titled sections.
// ============================================================

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  ChevronDown,
  DoorOpen,
  Flag,
  ListChecks,
  MessageSquareText,
  TextCursorInput,
} from "lucide-react";

import { ROUTE_LABEL } from "@/lib/quiz/builder";
import { cleanTag } from "@/lib/quiz/validate";
import type { QuizDefinition, QuizRoute, QuizStep } from "@/lib/quiz/types";
import { cn } from "@/lib/utils";

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

// ------------------------------------------------------------
// Colours
// ------------------------------------------------------------

export type ScreenKind = "intro" | "choice" | "fields" | "message" | "result";

/**
 * Written out in full (no string building): Tailwind only ships the
 * classes it finds in the source.
 */
export const SCREEN_STYLE: Record<
  ScreenKind,
  { label: string; icon: ComponentType<{ className?: string }>; node: string; text: string; soft: string }
> = {
  intro: {
    label: "Tela de entrada",
    icon: DoorOpen,
    node: "bg-violet-500 text-white",
    text: "text-violet-600 dark:text-violet-300",
    soft: "bg-violet-500/10",
  },
  choice: {
    label: "Pergunta",
    icon: ListChecks,
    node: "bg-sky-500 text-white",
    text: "text-sky-600 dark:text-sky-300",
    soft: "bg-sky-500/10",
  },
  fields: {
    label: "Campos",
    icon: TextCursorInput,
    node: "bg-emerald-500 text-white",
    text: "text-emerald-600 dark:text-emerald-300",
    soft: "bg-emerald-500/10",
  },
  message: {
    label: "Mensagem",
    icon: MessageSquareText,
    node: "bg-amber-500 text-white",
    text: "text-amber-600 dark:text-amber-300",
    soft: "bg-amber-500/10",
  },
  result: {
    label: "Resultado",
    icon: Flag,
    node: "bg-primary text-primary-foreground",
    text: "text-primary",
    soft: "bg-primary-soft",
  },
};

export function screenKind(step: QuizStep): ScreenKind {
  return step.type;
}

export const ROUTE_STYLE: Record<
  QuizRoute,
  { badge: string; dot: string; border: string; soft: string; text: string; ring: string }
> = {
  A: {
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    border: "border-l-emerald-500",
    soft: "bg-emerald-500/8",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/60",
  },
  B: {
    badge: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    border: "border-l-amber-500",
    soft: "bg-amber-500/8",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/60",
  },
  C: {
    badge: "bg-foreground/8 text-muted-foreground",
    dot: "bg-muted-foreground",
    border: "border-l-muted-foreground/50",
    soft: "bg-foreground/5",
    text: "text-muted-foreground",
    ring: "ring-foreground/30",
  },
};

export function RouteBadge({ route, className }: { route: QuizRoute; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        ROUTE_STYLE[route].badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", ROUTE_STYLE[route].dot)} />
      {ROUTE_LABEL[route]}
    </span>
  );
}

/** A small rounded square with the icon of a kind of screen. */
export function ScreenIcon({ kind, className }: { kind: ScreenKind; className?: string }) {
  const style = SCREEN_STYLE[kind];
  const Icon = style.icon;
  return (
    <span
      aria-hidden
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", style.node, className)}
    >
      <Icon className="size-4" />
    </span>
  );
}

// ------------------------------------------------------------
// Layout
// ------------------------------------------------------------

/** A titled block of settings. Its rows are separated by hairlines. */
export function Section({
  title,
  hint,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface rounded-3xl p-5 sm:p-6", className)}>
      <header className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Icon className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {hint ? (
              <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-muted-foreground">{hint}</p>
            ) : null}
          </div>
        </div>
        {action}
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/**
 * One setting: what it is and why on the left, the control on the
 * right. Stacks on a narrow screen.
 */
export function FormRow({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-8 gap-y-3 py-5 first:pt-4 last:pb-1 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
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
      <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground/75">
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
 * Underlined tabs for the parts of one editor tab. Deliberately unlike
 * the numbered tabs above them: those move between steps of building
 * the quiz, these between parts of one step.
 */
export function SubTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: { value: T; label: string; count?: number; icon?: ComponentType<{ className?: string }> }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex max-w-full gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pt-1 pb-2.5 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.icon ? <item.icon className="size-4" /> : null}
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  active ? "bg-primary-soft-2 text-foreground" : "bg-foreground/8",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** "E" or "OU" between two conditions, on the line that joins them. */
export function Connector({ match }: { match: "all" | "any" }) {
  return (
    <div aria-hidden className="relative flex justify-center py-2.5">
      <span className="absolute inset-x-8 top-1/2 h-px bg-foreground/15" />
      <span
        className={cn(
          "relative rounded-full px-3 py-0.5 text-[11px] font-bold tracking-widest text-white shadow-sm",
          match === "all" ? "bg-sky-500" : "bg-violet-500",
        )}
      >
        {match === "all" ? "E" : "OU"}
      </span>
    </div>
  );
}

/** The capitalised word in front of a sentence of logic: SE, ENTÃO, QUANDO. */
export function LogicWord({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-md bg-foreground/8 px-2 text-[11px] font-semibold tracking-wider text-foreground/70",
        className,
      )}
    >
      {children}
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
    <div className="space-y-2">
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
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-foreground/8 px-2 py-0.5 font-mono text-[11px] text-foreground/80"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A panel that opens to show more settings, closed by default. */
export function MoreOptions({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {label}
      </button>
      {open ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}
