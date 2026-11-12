// ============================================================
// The pacing of a bulk send through the QR-code number (Fase 8 of
// docs/plano-extensao-chrome.md). Pure, so it is tested.
//
// Decided on 10/11/2026: at most BULK_DAILY_LIMIT sends a day per CRM,
// one every 30–90 seconds — drawn at random, so the rhythm doesn't look
// like a machine's — and one bulk send after the other, never two at
// once. Volume and regularity are what get a QR-code number banned.
// ============================================================

export const BULK_DAILY_LIMIT = 200;
/** Also the most one bulk send may carry. */
export const BULK_MAX_RECIPIENTS = BULK_DAILY_LIMIT;
export const BULK_GAP_MIN_S = 30;
export const BULK_GAP_MAX_S = 90;
/** The first send is at least this far after the click. */
export const BULK_START_DELAY_S = 60;

/** One gap, in ms, between BULK_GAP_MIN_S and BULK_GAP_MAX_S. */
export function drawGapMs(random: () => number = Math.random): number {
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round((BULK_GAP_MIN_S + r * (BULK_GAP_MAX_S - BULK_GAP_MIN_S)) * 1000);
}

/**
 * When each of `n` messages goes, in ms: the first one gap after
 * `afterMs`, then one gap after another.
 */
export function planSendTimes(
  n: number,
  afterMs: number,
  random: () => number = Math.random
): number[] {
  const times: number[] = [];
  let t = afterMs;
  for (let i = 0; i < n; i += 1) {
    t += drawGapMs(random);
    times.push(t);
  }
  return times;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar day in Brasília time, "2026-11-10". */
export function dayKey(ms: number): string {
  return dayFormat.format(new Date(ms));
}

/**
 * Whether the planned sends fit the daily limit, given what each day
 * already has. On the first day that overflows: how many more it takes.
 */
export function checkDailyLimit(
  planned: number[],
  existing: Record<string, number>,
  limit: number = BULK_DAILY_LIMIT
): { ok: true } | { ok: false; day: string; room: number } {
  const counts: Record<string, number> = { ...existing };
  for (const t of planned) {
    const day = dayKey(t);
    counts[day] = (counts[day] ?? 0) + 1;
    if (counts[day] > limit) {
      return { ok: false, day, room: Math.max(0, limit - (existing[day] ?? 0)) };
    }
  }
  return { ok: true };
}
