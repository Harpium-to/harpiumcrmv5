import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The Harpium harpy-eagle head, traced as a vector from the brand logo
 * so it stays sharp at any size and can be animated (the uploaded logo
 * is a photo of the mark on a wall, which neither scales nor animates).
 *
 * `animated` plays the entrance once — the outline draws itself, then
 * the metal fills in — and leaves a light sweeping across the mark
 * every few seconds. The keyframes live in globals.css (`hm-*`) and
 * switch off under prefers-reduced-motion.
 */
const HEAD =
  "M256 414 L344 356 C390 375 430 390 466 396 C428 386 388 366 362 338 C352 322 344 304 347 285 " +
  "C372 312 420 306 470 302 C560 296 660 296 705 330 C735 352 752 392 762 428 " +
  "C776 440 786 456 786 474 C760 462 730 458 700 462 C600 480 500 560 455 735 " +
  "C440 560 380 450 256 414 Z " +
  "M640 386 C662 378 722 392 758 428 C720 418 668 412 646 404 C634 400 632 390 640 386 Z";

export function HarpiumMark({
  className,
  animated = false,
  title = "Harpium",
}: {
  className?: string;
  animated?: boolean;
  title?: string;
}) {
  // Two marks on one page (say, the top bar and a card) must not share
  // gradient ids, or the second one paints with the first one's defs.
  const uid = useId().replace(/:/g, "");
  const metal = `hm-metal-${uid}`;
  const sheen = `hm-sheen-${uid}`;
  const clip = `hm-clip-${uid}`;

  return (
    <svg
      viewBox="236 266 570 489"
      role="img"
      aria-label={title}
      className={cn(animated && "hm-animated", className)}
    >
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9c9c9" />
          <stop offset="0.55" stopColor="#8a8a8a" />
          <stop offset="1" stopColor="#555555" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={HEAD} fillRule="evenodd" clipRule="evenodd" />
        </clipPath>
      </defs>

      <path
        className="hm-body"
        d={HEAD}
        fill={`url(#${metal})`}
        fillRule="evenodd"
        stroke={`url(#${metal})`}
        strokeWidth={animated ? 6 : 0}
        strokeLinejoin="round"
        pathLength={1}
      />

      {animated ? (
        <g clipPath={`url(#${clip})`}>
          <rect className="hm-sheen" x="100" y="250" width="220" height="520" fill={`url(#${sheen})`} />
        </g>
      ) : null}
    </svg>
  );
}
