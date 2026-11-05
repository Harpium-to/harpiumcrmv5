"use client";

import Link from "next/link";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { HELP_TIPS, type HelpTipId } from "@/lib/help/topics";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The ⓘ next to a field or heading. Click (not hover) opens it, so it
 * works the same on a phone, and the text stays put while it is read.
 */
export function HelpTip({ id, className }: { id: HelpTipId; className?: string }) {
  const tip = HELP_TIPS[id];

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Ajuda: ${tip.title}`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground",
          className,
        )}
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80">
        <PopoverTitle className="text-foreground">{tip.title}</PopoverTitle>
        <PopoverDescription className="leading-relaxed">{tip.body}</PopoverDescription>
        {"topic" in tip && tip.topic ? (
          <Link
            href={`/ajuda#${tip.topic}`}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Ver tutorial completo →
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
