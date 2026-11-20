"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";

// ============================================================
// The little Markdown the assistant writes: paragraphs, "- " and
// "1. " lists, ### headings, **bold**, `code` and [links](/path).
//
// Built as React elements — never HTML strings — so nothing the model
// (or a customer quoted by it) writes can inject markup. Links only go
// to a path inside the CRM or to an https page, which opens in a new
// tab; anything else is shown as plain text.
// ============================================================

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
    } else if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const text = (bullet ?? numbered)![1];
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] } as Block);
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

export function safeHref(href: string): { internal: boolean; href: string } | null {
  const h = href.trim();
  if (h.startsWith("/") && !h.startsWith("//")) return { internal: true, href: h };
  if (/^https:\/\/[^\s]+$/i.test(h)) return { internal: false, href: h };
  return null;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, onNavigate?: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    const key = i++;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>,
      );
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {part.slice(1, -1)}
        </code>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      const target = link ? safeHref(link[2]) : null;
      if (link && target) {
        // Foreground + underline, not the accent colour: in the default "sand"
        // theme the accent is a light cream that disappears on a white panel.
        const cls = "font-medium text-foreground underline decoration-foreground/35 underline-offset-2 hover:decoration-foreground";
        out.push(
          target.internal ? (
            <Link key={key} href={target.href} className={cls} onClick={onNavigate}>
              {link[1]}
            </Link>
          ) : (
            <a key={key} href={target.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {link[1]}
            </a>
          ),
        );
      } else if (link) {
        out.push(<Fragment key={key}>{link[1]}</Fragment>);
      } else {
        // Keep the model's single line breaks inside a paragraph.
        const pieces = part.split("\n");
        pieces.forEach((piece, j) => {
          out.push(<Fragment key={`${key}-${j}`}>{piece}</Fragment>);
          if (j < pieces.length - 1) out.push(<br key={`${key}-br-${j}`} />);
        });
      }
    }
  }
  return out;
}

export function HarpiMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <p key={i} className="pt-1 text-sm font-semibold text-foreground">
              {inline(b.text, onNavigate)}
            </p>
          );
        }
        if (b.kind === "p") return <p key={i}>{inline(b.text, onNavigate)}</p>;
        const List = b.kind === "ul" ? "ul" : "ol";
        return (
          <List
            key={i}
            className={b.kind === "ul" ? "list-disc space-y-1 pl-5" : "list-decimal space-y-1 pl-5"}
          >
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, onNavigate)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
