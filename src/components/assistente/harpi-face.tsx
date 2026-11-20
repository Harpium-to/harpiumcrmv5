"use client";

import { cn } from "@/lib/utils";

export type HarpiMood = "idle" | "thinking" | "waiting" | "happy" | "error" | "sleeping";

/**
 * Harpi's face: a little harpy eagle (the Harpium bird), drawn in SVG
 * so it scales from the 28px avatar beside a message to the launcher.
 *
 * The head takes the theme's primary colour; eyes, pupils and the
 * amber beak are fixed, so it reads the same on every palette. The
 * mood only changes the eyes and a small animation (globals.css,
 * "Harpi").
 */
export function HarpiFace({
  mood = "idle",
  className,
  title,
}: {
  mood?: HarpiMood;
  className?: string;
  title?: string;
}) {
  const happy = mood === "happy";
  const asleep = mood === "sleeping";
  const worried = mood === "error";
  return (
    <svg
      viewBox="0 0 48 48"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn(
        "shrink-0",
        mood === "thinking" && "harpi-thinking",
        happy && "harpi-happy",
        className,
      )}
    >
      {title ? <title>{title}</title> : null}
      <g className="harpi-head">
        {/* Crest: the harpy's two feather tufts */}
        <path d="M15 12 L11 2 L20 9 Z" fill="var(--primary)" />
        <path d="M33 12 L37 2 L28 9 Z" fill="var(--primary)" />
        <path d="M24 9 L22 3 L26 3 Z" fill="var(--primary)" opacity="0.85" />
        <circle cx="24" cy="26" r="19" fill="var(--primary)" />
        {/* A lighter face mask */}
        <ellipse cx="24" cy="29" rx="14" ry="12" fill="#ffffff" opacity="0.16" />
        {/* Brows: raised while waiting, slanted when something failed */}
        {mood === "waiting" ? (
          <>
            <path d="M12.5 15.5 Q16.5 12.5 20.5 15" stroke="#1d1b1a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            <path d="M27.5 15 Q31.5 12.5 35.5 15.5" stroke="#1d1b1a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </>
        ) : worried ? (
          <>
            <path d="M13 16 L20 18" stroke="#1d1b1a" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M35 16 L28 18" stroke="#1d1b1a" strokeWidth="1.8" strokeLinecap="round" />
          </>
        ) : null}
        {/* Eyes */}
        {happy || asleep ? (
          <>
            <path
              d={happy ? "M12.5 24 Q16.5 19.5 20.5 24" : "M12.5 23 Q16.5 26 20.5 23"}
              stroke="#1d1b1a"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={happy ? "M27.5 24 Q31.5 19.5 35.5 24" : "M27.5 23 Q31.5 26 35.5 23"}
              stroke="#1d1b1a"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <g className="harpi-eye">
              <ellipse cx="16.5" cy="23" rx="5" ry="5.6" fill="#ffffff" stroke="#1d1b1a" strokeOpacity="0.18" />
              <circle className="harpi-pupil" cx={worried ? 16.5 : 17.3} cy={worried ? 23.6 : 23.4} r={worried ? 1.8 : 2.5} fill="#1d1b1a" />
            </g>
            <g className="harpi-eye">
              <ellipse cx="31.5" cy="23" rx="5" ry="5.6" fill="#ffffff" stroke="#1d1b1a" strokeOpacity="0.18" />
              <circle className="harpi-pupil" cx={worried ? 31.5 : 32.3} cy={worried ? 23.6 : 23.4} r={worried ? 1.8 : 2.5} fill="#1d1b1a" />
            </g>
          </>
        )}
        {/* Beak */}
        <path d="M20.5 30 Q24 28.5 27.5 30 L24 36.5 Z" fill="#f2a529" stroke="#b86e0a" strokeWidth="0.8" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
