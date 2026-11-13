"use client";

// The icon of a quiz model, each niche in a colour of its own, so the
// list of models reads at a glance.

import {
  Briefcase,
  Building2,
  Dumbbell,
  FilePlus,
  GraduationCap,
  House,
  Mail,
  Scale,
  ShoppingBag,
  Smile,
  Sofa,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  type LucideIcon,
} from "lucide-react";

import type { QuizModelIcon } from "@/lib/quiz/model-meta";
import { cn } from "@/lib/utils";

/** Written out in full: Tailwind only ships the classes it finds in the source. */
const ICONS: Record<QuizModelIcon | "agency", { icon: LucideIcon; tone: string }> = {
  stethoscope: { icon: Stethoscope, tone: "bg-sky-500/14 text-sky-600 dark:text-sky-300" },
  smile: { icon: Smile, tone: "bg-teal-500/14 text-teal-600 dark:text-teal-300" },
  sparkles: { icon: Sparkles, tone: "bg-fuchsia-500/14 text-fuchsia-600 dark:text-fuchsia-300" },
  dumbbell: { icon: Dumbbell, tone: "bg-orange-500/14 text-orange-600 dark:text-orange-300" },
  house: { icon: House, tone: "bg-blue-500/14 text-blue-600 dark:text-blue-300" },
  scale: { icon: Scale, tone: "bg-amber-600/14 text-amber-700 dark:text-amber-300" },
  graduation: { icon: GraduationCap, tone: "bg-violet-500/14 text-violet-600 dark:text-violet-300" },
  shopping: { icon: ShoppingBag, tone: "bg-rose-500/14 text-rose-600 dark:text-rose-300" },
  briefcase: { icon: Briefcase, tone: "bg-emerald-600/14 text-emerald-700 dark:text-emerald-300" },
  sun: { icon: Sun, tone: "bg-yellow-500/16 text-yellow-700 dark:text-yellow-300" },
  mail: { icon: Mail, tone: "bg-slate-500/14 text-slate-600 dark:text-slate-300" },
  star: { icon: Star, tone: "bg-amber-500/14 text-amber-600 dark:text-amber-300" },
  blank: { icon: FilePlus, tone: "bg-foreground/8 text-foreground/70" },
  sofa: { icon: Sofa, tone: "bg-stone-500/14 text-stone-600 dark:text-stone-300" },
  agency: { icon: Building2, tone: "bg-primary-soft-2 text-foreground" },
};

export function ModelIcon({
  icon,
  className,
  size = "md",
}: {
  icon: QuizModelIcon | "agency";
  className?: string;
  size?: "md" | "lg";
}) {
  const { icon: Icon, tone } = ICONS[icon] ?? ICONS.blank;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "lg" ? "size-12 rounded-2xl" : "size-9 rounded-xl",
        tone,
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-6" : "size-4"} />
    </span>
  );
}
