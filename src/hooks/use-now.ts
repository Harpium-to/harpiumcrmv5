"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs`. For labels like
 * "esperando há 12 min" that must keep counting without new data.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
