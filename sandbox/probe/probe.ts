import { createWerk, type TaskContext } from '@werk/core'
import {
  type CatalogEntry,
  catalogEntries,
  type SearchHit,
  type SearchResult,
  scoreEntry,
} from '../src/demo/catalog'
import type { YieldTransport } from '../src/demo/dials'
import { TopHits } from '../src/demo/top-hits'
import { createTransportYield } from '../src/demo/yield-transport'

export interface ProbeOptions {
  records: number
  budgetMs: number
  query: string
  limit: number
  /** `auto` uses core's fallback chain; the others force one primitive. */
  transport: YieldTransport
}

export interface ProbeResult {
  records: number
  budgetMs: number
  transport: YieldTransport
  buildMs: number
  scanMs: number
  yields: number
  matches: number
  worstSliceMs: number
  sliceP50Ms: number
  sliceP95Ms: number
  sliceP99Ms: number
  overBudgetSlices: number
  slices: number[]
  worstYieldWaitMs: number
  buildYields: number
  buildWorstSliceMs: number
  buildOverBudgetSlices: number
  frameCount: number
  frameMinMs: number
  frameP50Ms: number
  frameP95Ms: number
  frameMaxMs: number
  /** Long tasks (>50 ms) that started during the scan. */
  longTasks: number
  /** Long tasks that started while the catalogue was being built. */
  buildLongTasks: number
}

interface SliceStats {
  worst: number
  overBudget: number
  yields: number
  worstYieldWait: number
  slices: number[]
}

const SLICE_TOLERANCE_MS = 0.5

function createSliceStats(): SliceStats {
  return { worst: 0, overBudget: 0, yields: 0, worstYieldWait: 0, slices: [] }
}

function round(value: number): number {
  return Number(value.toFixed(2))
}

/**
 * Times the same cooperative loops the sandbox runs, but measures each slice directly instead of
 * inferring it from frame gaps. A slice is the work between two yields; `worstSliceMs` is the
 * longest one, so comparing it to `budgetMs` is the real budget check.
 */
export async function runProbe(options: ProbeOptions): Promise<ProbeResult> {
  const { budgetMs } = options
  const werk =
    options.transport === 'auto'
      ? createWerk({ budgetMs })
      : createWerk({ budgetMs, yield: createTransportYield(options.transport) })

  const scanFrames: number[] = []
  let phase: 'idle' | 'build' | 'scan' = 'idle'
  let previousFrame = 0
  let rafId = 0

  const tick = (now: number): void => {
    if (rafId === 0 && previousFrame === 0) previousFrame = now
    if (phase === 'scan' && previousFrame !== 0) {
      const delta = now - previousFrame
      if (delta > 0 && delta < 1_000) scanFrames.push(delta)
    }
    previousFrame = now
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  let scanLongTasks = 0
  let buildLongTasks = 0
  let scanStartedAt = Number.POSITIVE_INFINITY
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime >= scanStartedAt) scanLongTasks += 1
        else buildLongTasks += 1
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    observer = undefined
  }

  const buildStats = createSliceStats()
  phase = 'build'
  const buildStarted = performance.now()
  const entries =
    (await werk.task((context) => buildCatalog(context, options.records, buildStats)).run()) ?? []
  const buildMs = performance.now() - buildStarted

  const stats = createSliceStats()
  phase = 'scan'
  const scanStarted = performance.now()
  scanStartedAt = scanStarted
  const result = await werk.task((context) => scanCatalog(context, options, entries, stats)).run()
  const scanMs = performance.now() - scanStarted
  phase = 'idle'

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => setTimeout(resolve, 250))

  cancelAnimationFrame(rafId)
  observer?.disconnect()

  const sortedFrames = scanFrames.sort((left, right) => left - right)
  const frameAt = (quantile: number): number =>
    sortedFrames[Math.floor(sortedFrames.length * quantile)] ?? 0

  if (result === undefined) throw new Error('probe scan returned no result')

  return {
    records: options.records,
    budgetMs,
    transport: options.transport,
    buildMs: Math.round(buildMs),
    scanMs: Math.round(scanMs),
    yields: stats.yields,
    matches: result.totalMatches,
    worstSliceMs: round(stats.worst),
    sliceP50Ms: percentile(stats.slices, 0.5),
    sliceP95Ms: percentile(stats.slices, 0.95),
    sliceP99Ms: percentile(stats.slices, 0.99),
    overBudgetSlices: stats.overBudget,
    slices: stats.slices,
    buildYields: buildStats.yields,
    buildWorstSliceMs: round(buildStats.worst),
    buildOverBudgetSlices: buildStats.overBudget,
    worstYieldWaitMs: round(stats.worstYieldWait),
    frameCount: sortedFrames.length,
    frameMinMs: round(sortedFrames[0] ?? 0),
    frameP50Ms: round(frameAt(0.5)),
    frameP95Ms: round(frameAt(0.95)),
    frameMaxMs: round(sortedFrames[sortedFrames.length - 1] ?? 0),
    longTasks: scanLongTasks,
    buildLongTasks,
  }
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return round(sorted[Math.floor(sorted.length * quantile)] ?? 0)
}

function accountSlice(stats: SliceStats, elapsed: number, budgetMs: number): void {
  stats.yields += 1
  stats.slices.push(round(elapsed))
  if (elapsed > stats.worst) stats.worst = elapsed
  if (elapsed > budgetMs + SLICE_TOLERANCE_MS) stats.overBudget += 1
}

async function buildCatalog(
  context: TaskContext,
  target: number,
  stats: SliceStats,
): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = []
  let sliceStart = performance.now()

  for (const entry of catalogEntries(target)) {
    entries.push(entry)
    if (context.budget.exceeded()) {
      accountSlice(stats, performance.now() - sliceStart, context.budget.budgetMs)
      await context.yieldNow()
      sliceStart = performance.now()
    }
  }

  return entries
}

async function scanCatalog(
  context: TaskContext,
  options: ProbeOptions,
  entries: readonly CatalogEntry[],
  stats: SliceStats,
): Promise<SearchResult> {
  const normalized = options.query.trim().toLowerCase()
  if (normalized.length === 0) return { hits: [], totalMatches: 0 }

  const top = new TopHits<SearchHit>(options.limit)
  let totalMatches = 0
  let processed = 0
  let sliceStart = performance.now()

  for (const entry of entries) {
    const score = scoreEntry(entry, normalized)
    if (score > 0) {
      totalMatches += 1
      if (top.wouldAccept(score)) top.add({ entry, score })
    }
    processed += 1

    if (context.budget.exceeded()) {
      accountSlice(stats, performance.now() - sliceStart, options.budgetMs)
      context.reportProgress(processed, entries.length)
      const yieldStarted = performance.now()
      await context.yieldNow()
      const wait = performance.now() - yieldStarted
      if (wait > stats.worstYieldWait) stats.worstYieldWait = wait
      sliceStart = performance.now()
    }
  }

  context.reportProgress(entries.length, entries.length)
  return { hits: top.sorted(), totalMatches }
}
