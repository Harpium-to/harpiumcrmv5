"use client";

// ============================================================
// The screens of a quiz, as plain components: the frame (logo, step
// counter, progress bar), the entry screen, a choice question, a
// screen of fields, a message and a result.
//
// They hold no state about the visit — the player (quiz-player.tsx)
// does, and the builder's preview renders the same components with
// sample data. That is what keeps "what I see while editing" and "what
// the visitor gets" the same markup.
// ============================================================

import {
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowUpRight, Check, Gift, Lightbulb, MessageCircle } from "lucide-react";

import { fieldError, interpolate, normalizeFieldValue, type QuizVars } from "@/lib/quiz/engine";
import type {
  ChoiceStep,
  FieldKind,
  FieldsStep,
  MessageStep,
  QuizAnswers,
  QuizDefinition,
  QuizField,
  QuizIntro,
  QuizResult,
  ResultBlock,
  ResultIcon,
} from "@/lib/quiz/types";

import "./quiz-player.css";

// ------------------------------------------------------------
// Colours
// ------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [34, 206, 210];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The quiz's accent colour and the shades derived from it. Text on the
 * accent is a near-black of the same hue on a light colour and white
 * on a dark one, so any colour a client picks stays readable.
 */
export function themeVars(accent: string): CSSProperties {
  const c = rgb(accent);
  const mix = (t: number, to: number) => c.map((v) => Math.round(v + (to - v) * t));
  const css = (v: number[]) => `rgb(${v[0]}, ${v[1]}, ${v[2]})`;
  const light = luminance(c) > 0.4;
  return {
    "--qz-accent": css(c),
    "--qz-accent-deep": css(mix(light ? 0.14 : 0.1, 0)),
    "--qz-on-accent": light ? css(mix(0.82, 0)) : "#ffffff",
    "--qz-accent-ring": `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.16)`,
    "--qz-accent-tint": css(mix(0.93, 255)),
  } as CSSProperties;
}

// ------------------------------------------------------------
// Text
// ------------------------------------------------------------

/** `**bold**` and line breaks; everything else is plain text. */
export function rich(text: string): ReactNode {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      {line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
        j % 2 === 1 ? <strong key={j}>{part}</strong> : part,
      )}
    </span>
  ));
}

// ------------------------------------------------------------
// Frame
// ------------------------------------------------------------

interface QuizFrameProps {
  definition: QuizDefinition;
  /** The business's name, shown when the quiz has no logo or brand name. */
  business: string;
  /** "03 / 12". Omit on the entry screen and on the result. */
  counter?: { current: number; total: number };
  /** 0–1. Omit to hide the bar (entry screen). */
  progress?: number;
  /** "page" fills the window; "box" fills whatever holds it. */
  fill?: "page" | "box";
  children: ReactNode;
}

export function QuizFrame({
  definition,
  business,
  counter,
  progress,
  fill = "page",
  children,
}: QuizFrameProps) {
  const { appearance } = definition;
  const brand = appearance.brandName || business;
  return (
    <div className="qz" data-fill={fill} style={themeVars(appearance.accent)}>
      <div aria-hidden className="qz-halo" />
      <header className="qz-wrap qz-header">
        {appearance.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={appearance.logoUrl} alt={brand} className="qz-logo" />
        ) : (
          <span className="qz-brand">{brand}</span>
        )}
        {counter ? (
          <span className="qz-hud" aria-live="polite">
            {String(counter.current).padStart(2, "0")} / {String(counter.total).padStart(2, "0")}
          </span>
        ) : null}
      </header>
      {progress !== undefined ? (
        <div className="qz-wrap qz-progress">
          <div
            className="qz-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div
              className="qz-progress-fill"
              style={{ width: `${Math.max(progress * 100, 4)}%` }}
            />
          </div>
        </div>
      ) : null}
      <section className="qz-wrap qz-body">{children}</section>
    </div>
  );
}

function Pill({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button {...props} className="qz-pill">
      {children}
      <span className="qz-pill-arrow">
        <ArrowUpRight size={16} strokeWidth={2} />
      </span>
    </button>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="qz-back">
      <ArrowLeft size={16} /> Voltar
    </button>
  );
}

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------

export function IntroScreen({
  intro,
  onStart,
  autoFocus = true,
}: {
  intro: QuizIntro;
  onStart: () => void;
  /** Off in the builder's preview, which must not take the focus from the editor. */
  autoFocus?: boolean;
}) {
  return (
    <div>
      {intro.tag ? <p className="qz-hud qz-tag qz-in">{intro.tag}</p> : null}
      <h1 className="qz-headline qz-in qz-in-2">{intro.headline}</h1>
      {intro.sub ? <p className="qz-sub qz-in qz-in-2">{intro.sub}</p> : null}
      <div className="qz-intro-cta qz-in qz-in-3">
        <Pill type="button" onClick={onStart} autoFocus={autoFocus}>
          {intro.cta}
        </Pill>
      </div>
      {intro.bullets.length > 0 ? (
        <ul className="qz-proof qz-in qz-in-3">
          {intro.bullets.map((item, i) => (
            <li key={i}>
              <span className="qz-proof-check">
                <Check size={12} strokeWidth={3} />
              </span>
              <span>
                {item.strong ? <strong>{item.strong}</strong> : null} {item.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// A choice question
// ------------------------------------------------------------

const KEYS = "ABCDEFGHIJKLMNOPQRST";

export function ChoiceScreen({
  step,
  vars,
  selected,
  onAnswer,
}: {
  step: ChoiceStep;
  vars: Partial<QuizVars>;
  selected: string[];
  onAnswer: (value: string | string[]) => void;
}) {
  // The option lights up at once and the quiz moves on a beat later,
  // so the tap has a visible answer.
  const [marked, setMarked] = useState<string[]>(selected);
  const locked = useRef(false);

  const choose = (id: string) => {
    if (step.multiple) {
      setMarked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
      return;
    }
    if (locked.current) return; // a double tap answers once
    locked.current = true;
    setMarked([id]);
    window.setTimeout(() => onAnswer(id), 240);
  };

  return (
    <fieldset>
      {step.context ? (
        <p className="qz-context qz-in">{interpolate(step.context, vars)}</p>
      ) : null}
      <legend style={{ display: "contents" }}>
        <h2 className="qz-title qz-in">{interpolate(step.title, vars)}</h2>
      </legend>
      {step.note ? <p className="qz-note qz-in">{step.note}</p> : null}
      {step.multiple ? <p className="qz-note qz-in">Pode marcar mais de uma.</p> : null}

      <div className="qz-options qz-in qz-in-2">
        {step.options.map((option, i) => (
          <button
            key={option.id}
            type="button"
            onClick={() => choose(option.id)}
            aria-pressed={marked.includes(option.id)}
            className="qz-option"
          >
            <span className="qz-option-key">{KEYS[i] ?? "•"}</span>
            {option.label}
          </button>
        ))}
      </div>

      {step.multiple ? (
        <div className="qz-actions qz-in qz-in-3">
          <Pill type="button" disabled={marked.length === 0} onClick={() => onAnswer(marked)}>
            Continuar
          </Pill>
        </div>
      ) : null}
    </fieldset>
  );
}

// ------------------------------------------------------------
// A screen of fields
// ------------------------------------------------------------

/** Brazilian WhatsApp as it is typed: (11) 91234-5678. */
function maskPhone(value: string): string {
  if (value.trim().startsWith("+") && !value.trim().startsWith("+55")) return value;
  const d = value.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const INPUT_PROPS: Record<FieldKind, InputHTMLAttributes<HTMLInputElement>> = {
  name: { autoComplete: "name", autoCapitalize: "words", maxLength: 80 },
  phone: { type: "tel", inputMode: "tel", autoComplete: "tel-national", maxLength: 20 },
  email: { type: "email", inputMode: "email", autoComplete: "email", autoCapitalize: "none", maxLength: 160 },
  company: { autoComplete: "organization", maxLength: 120 },
  city: { autoComplete: "address-level2", maxLength: 120 },
  instagram: { autoCapitalize: "none", autoCorrect: "off", maxLength: 60 },
  text: { maxLength: 200 },
  longtext: { maxLength: 2000 },
  number: { inputMode: "decimal", maxLength: 20 },
};

const HALF: FieldKind[] = ["company", "city", "number"];

/** Two short fields in a row share it; everything else takes the row. */
function spans(fields: QuizField[]): ("half" | "full")[] {
  const out: ("half" | "full")[] = fields.map(() => "full");
  for (let i = 0; i < fields.length - 1; i++) {
    if (HALF.includes(fields[i].kind) && HALF.includes(fields[i + 1].kind)) {
      out[i] = "half";
      out[i + 1] = "half";
      i++;
    }
  }
  return out;
}

export interface FieldsExtras {
  /** Small print beside the button. */
  privacyNote?: string;
  consentText?: string;
  privacyUrl?: string;
  /** Replaces the button text while the result is prepared. */
  submittingText?: string;
}

export function FieldsScreen({
  step,
  vars,
  initial,
  sending = false,
  extras,
  autoFocus = true,
  onSubmit,
}: {
  step: FieldsStep;
  vars: Partial<QuizVars>;
  initial: QuizAnswers;
  sending?: boolean;
  autoFocus?: boolean;
  /** Only the quiz's last screen carries the privacy lines. */
  extras?: FieldsExtras;
  onSubmit: (values: Record<string, string>, trap: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const field of step.fields) {
      const saved = initial[field.id];
      const value = typeof saved === "string" ? saved : "";
      start[field.id] = field.kind === "phone" ? maskPhone(value) : value;
    }
    return start;
  });
  const [tried, setTried] = useState(false);
  const [trap, setTrap] = useState("");
  const layout = spans(step.fields);

  const errors: Record<string, string | null> = {};
  for (const field of step.fields) errors[field.id] = fieldError(field, values[field.id] ?? "");
  const valid = Object.values(errors).every((e) => !e);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid || sending) return;
    const clean: Record<string, string> = {};
    for (const field of step.fields) {
      clean[field.id] = normalizeFieldValue(field, values[field.id] ?? "");
    }
    onSubmit(clean, trap);
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="qz-title qz-in">{interpolate(step.title, vars)}</h2>
      {step.note ? <p className="qz-note qz-in">{step.note}</p> : null}

      <div className="qz-fields qz-in qz-in-2">
        {step.fields.map((field, i) => {
          const error = tried ? errors[field.id] : null;
          const id = `qz-${field.id}`;
          const common = {
            id,
            className: "qz-input",
            value: values[field.id] ?? "",
            placeholder: field.placeholder,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": error ? `${id}-erro` : undefined,
            autoFocus: autoFocus && i === 0,
          };
          const change = (raw: string) =>
            setValues((now) => ({
              ...now,
              [field.id]: field.kind === "phone" ? maskPhone(raw) : raw,
            }));
          return (
            <div key={field.id} className="qz-field" data-span={layout[i]}>
              <label htmlFor={id} className="qz-field-label">
                {field.label}
                {field.required ? (
                  <span aria-hidden> *</span>
                ) : (
                  <span className="qz-field-optional"> (opcional)</span>
                )}
              </label>
              {field.kind === "longtext" ? (
                <textarea
                  {...common}
                  maxLength={2000}
                  onChange={(e) => change(e.target.value)}
                />
              ) : (
                <input
                  {...INPUT_PROPS[field.kind]}
                  {...common}
                  onChange={(e) => change(e.target.value)}
                />
              )}
              {error ? (
                <p id={`${id}-erro`} className="qz-field-error">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Hidden from people and from screen readers; a robot fills it. */}
      <input
        className="qz-trap"
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={trap}
        onChange={(e) => setTrap(e.target.value)}
      />

      {extras?.consentText ? (
        <p className="qz-small qz-in qz-in-3" style={{ marginTop: 20, textAlign: "left" }}>
          {extras.consentText}{" "}
          {extras.privacyUrl ? (
            <a href={extras.privacyUrl} target="_blank" rel="noreferrer">
              Política de privacidade
            </a>
          ) : null}
        </p>
      ) : null}

      <div className="qz-actions qz-in qz-in-3">
        <Pill type="submit" disabled={sending}>
          {sending ? extras?.submittingText || "Enviando…" : step.cta}
        </Pill>
        {extras?.privacyNote ? <p className="qz-small">{extras.privacyNote}</p> : null}
      </div>
    </form>
  );
}

// ------------------------------------------------------------
// A message
// ------------------------------------------------------------

export function MessageScreen({
  step,
  vars,
  autoFocus = true,
  onContinue,
}: {
  step: MessageStep;
  vars: Partial<QuizVars>;
  autoFocus?: boolean;
  onContinue: () => void;
}) {
  return (
    <div>
      <h2 className="qz-title qz-in">{interpolate(step.title, vars)}</h2>
      {step.text ? <p className="qz-text qz-in qz-in-2">{rich(interpolate(step.text, vars))}</p> : null}
      <div className="qz-actions qz-in qz-in-3">
        <Pill type="button" onClick={onContinue} autoFocus={autoFocus}>
          {step.cta}
        </Pill>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// The result
// ------------------------------------------------------------

function ResultGlyph({ icon, size }: { icon: ResultIcon; size: number }) {
  const props = { size, strokeWidth: 2.2 };
  if (icon === "bulb") return <Lightbulb {...props} />;
  if (icon === "gift") return <Gift {...props} />;
  if (icon === "message") return <MessageCircle {...props} />;
  return <Check {...props} strokeWidth={2.4} />;
}

function buttonHref(block: Extract<ResultBlock, { type: "button" }>): string {
  if (!block.url) return "";
  return block.kind === "whatsapp" ? `https://wa.me/${block.url}` : block.url;
}

export function ResultScreen({
  result,
  blocks,
  vars,
  showEmptyButtons = false,
  onButtonClick,
}: {
  result: QuizResult;
  /** The blocks this visitor sees (engine.visibleBlocks). */
  blocks: ResultBlock[];
  vars: Partial<QuizVars>;
  /** The builder shows a button that has no link yet; a visitor never does. */
  showEmptyButtons?: boolean;
  onButtonClick?: () => void;
}) {
  return (
    <div role="status">
      <span className="qz-seal qz-in">
        <ResultGlyph icon={result.icon} size={24} />
      </span>
      <h2 className="qz-result-title qz-in">{interpolate(result.title, vars)}</h2>
      {blocks.map((block) => {
        if (block.type === "text") {
          return (
            <p key={block.id} className="qz-result-text qz-in qz-in-2">
              {rich(interpolate(block.text, vars))}
            </p>
          );
        }
        if (block.type === "bullets") {
          return (
            <ul key={block.id} className="qz-bullets qz-in qz-in-2">
              {block.items.map((item, i) => (
                <li key={i}>
                  <Check size={16} strokeWidth={2.6} />
                  <span>{rich(interpolate(item, vars))}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "highlight") {
          return (
            <div key={block.id} className="qz-highlight qz-in qz-in-2">
              <ResultGlyph icon={block.icon} size={20} />
              <p>{rich(interpolate(block.text, vars))}</p>
            </div>
          );
        }
        const href = buttonHref(block);
        if (!href && !showEmptyButtons) return null;
        return (
          <div key={block.id} className="qz-result-cta qz-in qz-in-3">
            <a
              href={href || "#"}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="qz-pill"
              onClick={(e) => {
                if (!href) e.preventDefault();
                else onButtonClick?.();
              }}
            >
              {interpolate(block.label, vars)}
              <span className="qz-pill-arrow">
                <ArrowUpRight size={16} strokeWidth={2} />
              </span>
            </a>
          </div>
        );
      })}
    </div>
  );
}
