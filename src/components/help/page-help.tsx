"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";

import { topicForPath } from "@/lib/help/topics";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The "?" in the top bar: a short guide to whatever screen is open,
 * with the full tutorial one click away. On a screen with no topic it
 * goes straight to the help page instead of opening an empty card.
 */
export function PageHelp() {
  const pathname = usePathname();
  const topic = topicForPath(pathname);

  const buttonClass =
    "flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground data-popup-open:bg-foreground/8";

  if (!topic) {
    return (
      <Link href="/ajuda" aria-label="Ajuda e tutoriais" className={buttonClass}>
        <CircleHelp className="size-5" />
      </Link>
    );
  }

  return (
    <Popover>
      <PopoverTrigger aria-label={`Ajuda: ${topic.title}`} className={buttonClass}>
        <CircleHelp className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-3 p-4">
        <div className="space-y-1">
          <PopoverTitle className="text-base text-foreground">{topic.title}</PopoverTitle>
          <PopoverDescription className="leading-relaxed">{topic.summary}</PopoverDescription>
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
          {topic.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
          <Link href={`/ajuda#${topic.id}`} className="font-medium text-primary hover:underline">
            Ver tutorial completo →
          </Link>
          <Link href="/ajuda" className="text-muted-foreground hover:text-foreground">
            Todos os tutoriais
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
