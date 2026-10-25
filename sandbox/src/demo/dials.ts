import { DEFAULT_BUDGET_MS } from '@werk/core'
import { DEFAULT_CATALOG_SIZE } from './catalog'

/**
 * How werk reschedules between slices. `auto` is the @werk/core fallback chain (postTask first;
 * scheduler.yield only when postTask is unavailable).
 */
export type YieldTransport = 'auto' | 'postTask' | 'messageChannel' | 'schedulerYield'

/**
 * User-adjustable sandbox dials.
 *
 * Every value maps to a default that was previously hard-coded in the demo: the cooperative slice
 * budget, the catalogue size, the bounded top-K result limit, the ingestion row/batch sizes, and
 * the transport that decides how the work yields to the browser.
 */
export interface Dials {
  /** Slice budget handed to `werk.task` and `werk.ingest`, in milliseconds. */
  budgetMs: number
  /** Catalogue records generated for the fuzzy search. */
  recordCount: number
  /** Hits kept by the bounded top-K heap and rendered. */
  resultLimit: number
  /** Rows applied by the budgeted ingestion demo. */
  ingestRows: number
  /** Rows committed per ingestion slice. */
  ingestBatchSize: number
  /** Yield implementation used by the werk runtime. */
  yieldTransport: YieldTransport
}

/** Numeric dials, the ones backed by a range control. */
export type NumericDialKey = Exclude<keyof Dials, 'yieldTransport'>

export interface DialRange {
  min: number
  max: number
  step: number
}

export const DEFAULT_DIALS: Dials = {
  budgetMs: DEFAULT_BUDGET_MS,
  recordCount: DEFAULT_CATALOG_SIZE,
  resultLimit: 100,
  ingestRows: 15_000,
  ingestBatchSize: 400,
  yieldTransport: 'auto',
}

export const DIAL_RANGES: Record<NumericDialKey, DialRange> = {
  budgetMs: { min: 1, max: 16, step: 1 },
  recordCount: { min: 50_000, max: 1_000_000, step: 50_000 },
  resultLimit: { min: 25, max: 500, step: 25 },
  ingestRows: { min: 2_000, max: 60_000, step: 1_000 },
  ingestBatchSize: { min: 50, max: 2_000, step: 50 },
}

export function isDefaultDials(dials: Dials): boolean {
  return (Object.keys(DEFAULT_DIALS) as (keyof Dials)[]).every(
    (key) => dials[key] === DEFAULT_DIALS[key],
  )
}
