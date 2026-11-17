import type { ExtractedLead } from '../types'

// ============================================================
// What every source of the extractor answers. A source is a plug: the
// screen, the job runner, the duplicate check and the way into the CRM
// are the same whatever it is, so a provider can be swapped without
// touching them.
// ============================================================

/** Where the next slice of a job continues. Opaque to the runner. */
export type SourceCursor = Record<string, unknown>

export interface SourcePage {
  leads: ExtractedLead[]
  /** How many the source handed over, before our own filters. */
  fetched: number
  /** null: the source has nothing more for these filters. */
  cursor: SourceCursor | null
  /** What this page cost at the source, estimated (USD). */
  costUsd: number
  /** The source is still working: come back later with the cursor. */
  waiting: boolean
}

export type Availability = { available: true } | { available: false; reason: string }

export interface SourceAdapter<F> {
  /** Whether this source is set up on this server, and why not. */
  available(): Availability
  /** Up to `want` leads from where `cursor` left off ({} at the start). */
  fetchPage(filters: F, cursor: SourceCursor, want: number): Promise<SourcePage>
  /** How many the filters bring, counted up to `ceiling` (+1 = "more"). */
  count?(filters: F, ceiling: number): Promise<number>
}
