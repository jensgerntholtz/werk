<script setup lang="ts">
import { createWerk, type TaskContext, type TaskHandle, werk, type YieldFn } from '@werk/core'
import {
  computed,
  effectScope,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import DialControl from './components/DialControl.vue'
import FrameTimeChart from './components/FrameTimeChart.vue'
import {
  type CatalogEntry,
  catalogEntries,
  type SearchHit,
  type SearchResult,
  scoreEntry,
  searchCatalog,
} from './demo/catalog'
import {
  DEFAULT_DIALS,
  DIAL_RANGES,
  type Dials,
  isDefaultDials,
  type YieldTransport,
} from './demo/dials'
import { measureMainThread, type RunMetrics } from './demo/measure'
import { type DemoRow, makeRows } from './demo/rows'
import { TopHits } from './demo/top-hits'
import {
  createTransportYield,
  transportHint,
  transportLabel,
  YIELD_TRANSPORTS,
} from './demo/yield-transport'

type Mode = 'only' | 'off' | 'compare'

interface RunCard {
  id: 'on' | 'off'
  title: string
  tag: string
  metrics: RunMetrics
  yields: number
  /** Longest werk slice (work between two yields). Null for the blocking path. */
  worstSliceMs: number | null
  /** 95th-percentile slice: how often the budget actually held. Null for the blocking path. */
  sliceP95Ms: number | null
  /** Slices that ran more than half a millisecond past the configured budget. */
  overBudgetSlices: number | null
  budgetMs: number
}

interface RunState {
  query: string
  records: number
  budgetMs: number
  limit: number
  transport: YieldTransport
  cards: RunCard[]
}

const MODE_OPTIONS: readonly { value: Mode; label: string }[] = [
  { value: 'only', label: 'Werk Only' },
  { value: 'off', label: 'Werk Off' },
  { value: 'compare', label: 'Werk Compare' },
]

const dials = reactive<Dials>({ ...DEFAULT_DIALS })

/**
 * Werk runtime for the selected yield transport. `auto` uses the shared singleton (core's
 * postTask → MessageChannel chain, with scheduler.yield only as a fallback); the other options
 * build a runtime with an explicit yield function, which is what makes the worst-frame difference
 * measurable.
 */
const transportYields = new Map<Exclude<YieldTransport, 'auto'>, YieldFn>()
const runtime = computed(() => {
  const transport = dials.yieldTransport
  if (transport === 'auto') return werk

  let yieldFn = transportYields.get(transport)
  if (yieldFn === undefined) {
    yieldFn = createTransportYield(transport)
    transportYields.set(transport, yieldFn)
  }
  return createWerk({ yield: yieldFn })
})

// Catalogue state: generated cooperatively at the dialled size, then reused across searches.
const catalog = shallowRef<readonly CatalogEntry[]>([])
const builtSize = ref(0)
const buildError = ref('')
const activeBuild = shallowRef<TaskHandle<readonly CatalogEntry[]> | null>(null)
const building = computed(() => activeBuild.value !== null)
const buildProgress = computed(() => activeBuild.value?.progress.value ?? null)
const buildPercent = computed(() => {
  const progress = buildProgress.value
  if (progress?.kind !== 'determinate' || progress.total === 0) return null
  return Math.round((progress.completed / progress.total) * 100)
})
const buildCompleted = computed(() => {
  const progress = buildProgress.value
  return progress?.kind === 'determinate' ? progress.completed : null
})
const buildTotal = computed(() => {
  const progress = buildProgress.value
  return progress?.kind === 'determinate' ? progress.total : null
})

// Search state.
const query = ref('sil')
const result = shallowRef<SearchResult | null>(null)
const searchHandle = shallowRef<TaskHandle<SearchResult> | null>(null)
const searchProgress = computed(() => searchHandle.value?.progress.value ?? null)
const searchError = computed(() => {
  const error = searchHandle.value?.error.value ?? null
  if (error === null) return ''
  return error instanceof Error ? error.message : String(error)
})
const searchPercent = computed(() => {
  const progress = searchProgress.value
  if (progress?.kind !== 'determinate' || progress.total === 0) return null
  return Math.round((progress.completed / progress.total) * 100)
})
const searchCompleted = computed(() => {
  const progress = searchProgress.value
  return progress?.kind === 'determinate' ? progress.completed : null
})
const searchTotal = computed(() => {
  const progress = searchProgress.value
  return progress?.kind === 'determinate' ? progress.total : null
})

// Run state.
const mode = ref<Mode>('compare')
const modeRunning = ref(false)
const rerunQueued = ref(false)
const dialPending = ref(false)
const busy = computed(() => modeRunning.value || building.value || dialPending.value)
const runState = shallowRef<RunState | null>(null)
const blocking = ref(false)
const werkYields = ref(0)
const werkWorstSliceMs = ref(0)
const werkSliceP95Ms = ref(0)
const werkOverBudgetSlices = ref(0)
// A slice may overrun the budget by less than a microsecond without the user noticing; a GC pause
// or a JIT compile inside a slice is a real, visible overrun and gets counted.
const SLICE_TOLERANCE_MS = 0.5

const currentModeLabel = computed(
  () => MODE_OPTIONS.find((option) => option.value === mode.value)?.label ?? '',
)
const modeNote = computed(() => {
  if (mode.value === 'off') return 'Same work, no cooperative yields.'
  if (mode.value === 'only') return 'Cooperative path only, no baseline.'
  return 'Runs both paths back to back and compares them.'
})

const runLabel = computed(() => {
  if (mode.value === 'off') return 'Run werk off'
  if (mode.value === 'only') return 'Run werk only'
  return 'Compare werk on vs off'
})
const runTitle = computed(() => (mode.value === 'compare' ? 'A/B comparison' : 'Run metrics'))
const runNote = computed(() => {
  if (mode.value === 'off') {
    return 'Synchronous path only. The main thread is held for the whole search.'
  }

  const budget = runState.value?.budgetMs ?? dials.budgetMs
  const limit = runState.value?.limit ?? dials.resultLimit

  if (mode.value === 'only') {
    return `Cooperative path only. Worst slice is werk's work between yields, bounded by the ${budget} ms budget; worst frame is the paint gap, floored at one 16.7 ms refresh.`
  }
  return `Worst frame is the longest paint gap: one 60 Hz refresh is 16.7 ms, so ~17 ms means every frame landed. Worst slice is werk's own work between yields and is the number the ${budget} ms budget bounds. Both paths use the same scorer and ${limit}-hit limit.`
})

const hits = computed(() => result.value?.hits ?? [])
const totalMatches = computed(() => result.value?.totalMatches ?? 0)
const maxWorstFrame = computed(() =>
  Math.max(...(runState.value?.cards.map((card) => card.metrics.worstFrameMs) ?? [0]), 1),
)

function frameWidth(milliseconds: number): string {
  return `${Math.max(4, Math.round((milliseconds / maxWorstFrame.value) * 100))}%`
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function onCard(metrics: RunMetrics): RunCard {
  return {
    id: 'on',
    title: 'werk on',
    tag: 'cooperative',
    metrics,
    yields: werkYields.value,
    worstSliceMs: werkWorstSliceMs.value,
    sliceP95Ms: werkSliceP95Ms.value,
    overBudgetSlices: werkOverBudgetSlices.value,
    budgetMs: dials.budgetMs,
  }
}

function offCard(metrics: RunMetrics): RunCard {
  return {
    id: 'off',
    title: 'werk off',
    tag: 'blocking',
    metrics,
    yields: 0,
    worstSliceMs: null,
    sliceP95Ms: null,
    overBudgetSlices: null,
    budgetMs: dials.budgetMs,
  }
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return Number((sorted[Math.floor(sorted.length * quantile)] ?? 0).toFixed(2))
}

/** Worst slice as a share of the budget, so an over-budget slice fills the bar. */
function sliceWidth(card: RunCard): string {
  const worst = card.worstSliceMs ?? 0
  return `${Math.min(100, Math.round((worst / Math.max(card.budgetMs, 0.001)) * 100))}%`
}

async function generateCatalog(
  context: TaskContext,
  target: number,
): Promise<readonly CatalogEntry[]> {
  const entries: CatalogEntry[] = []
  context.reportProgress(0, target)

  for (const entry of catalogEntries(target)) {
    if (context.signal.aborted) break

    entries.push(entry)

    if (context.budget.exceeded()) {
      context.reportProgress(entries.length, target)
      await context.yieldNow()
    }
  }

  context.reportProgress(entries.length, entries.length)
  return entries
}

/**
 * Builds the catalogue at the dialled size in cooperative slices. Rebuilding releases the old
 * array first so a larger size never holds two full catalogues in the heap at once.
 *
 * The task lives in a detached effect scope: werk.task registers its cancel with the ambient
 * scope, and at mount time that is the component scope. Without the detached scope the first
 * completed handle (and the 600,000-record array in its `data` ref) would stay reachable for the
 * lifetime of the component after a later rebuild.
 */
async function ensureCatalog(): Promise<boolean> {
  const target = dials.recordCount
  if (builtSize.value === target) return true

  activeBuild.value?.cancel()
  catalog.value = []
  builtSize.value = 0
  buildError.value = ''

  const scope = effectScope(true)
  const handle = scope.run(() =>
    runtime.value.task<readonly CatalogEntry[]>((context) => generateCatalog(context, target), {
      budgetMs: dials.budgetMs,
    }),
  )

  if (handle === undefined) {
    scope.stop()
    buildError.value = 'Could not create the catalogue task.'
    return false
  }

  activeBuild.value = handle

  try {
    const entries = await handle.run()
    if (entries === undefined) return false

    catalog.value = entries
    builtSize.value = entries.length
    return true
  } catch (cause) {
    buildError.value = cause instanceof Error ? cause.message : String(cause)
    return false
  } finally {
    scope.stop()
    if (activeBuild.value === handle) activeBuild.value = null
  }
}

async function scanCatalog(context: TaskContext): Promise<SearchResult> {
  const normalized = query.value.trim().toLowerCase()
  const entries = catalog.value
  const limit = dials.resultLimit

  if (normalized.length === 0 || entries.length === 0) {
    context.reportProgress(entries.length, entries.length)
    return { hits: [], totalMatches: 0 }
  }

  const top = new TopHits<SearchHit>(limit)
  const total = entries.length
  const budgetMs = context.budget.budgetMs
  const sliceSamples: number[] = []
  let processed = 0
  let yields = 0
  let totalMatches = 0
  let worstSliceMs = 0
  let overBudgetSlices = 0
  let sliceStart = performance.now()

  for (const entry of entries) {
    if (context.signal.aborted) break

    const score = scoreEntry(entry, normalized)
    if (score > 0) {
      totalMatches += 1
      // Check the heap threshold before allocating a hit object: with a "sil"-style query most
      // of the scan matches and one allocation per match is enough churn to trigger a GC stall.
      if (top.wouldAccept(score)) {
        top.add({ entry, score })
      }
    }
    processed += 1

    if (context.budget.exceeded()) {
      // Time the slice itself, not the frame: several slices can share one frame.
      const sliceMs = performance.now() - sliceStart
      sliceSamples.push(sliceMs)
      if (sliceMs > worstSliceMs) worstSliceMs = sliceMs
      if (sliceMs > budgetMs + SLICE_TOLERANCE_MS) overBudgetSlices += 1
      yields += 1
      context.reportProgress(processed, total)
      await context.yieldNow()
      sliceStart = performance.now()
    }
  }

  werkYields.value = yields
  werkWorstSliceMs.value = worstSliceMs
  werkSliceP95Ms.value = percentile(sliceSamples, 0.95)
  werkOverBudgetSlices.value = overBudgetSlices
  context.reportProgress(total, total)
  return { hits: top.sorted(), totalMatches }
}

async function measureOn(): Promise<RunMetrics> {
  const handle = runtime.value.task<SearchResult>(scanCatalog, { budgetMs: dials.budgetMs })
  searchHandle.value = handle

  return measureMainThread(async () => {
    const next = await handle.run()
    if (next !== undefined) {
      result.value = next
    }
  })
}

async function runMode(): Promise<void> {
  if (busy.value) {
    rerunQueued.value = true
    return
  }

  window.clearTimeout(debounceTimer)
  rerunQueued.value = false
  modeRunning.value = true
  const activeMode = mode.value
  const queryAtStart = query.value
  const entries = catalog.value
  const transportAtStart = dials.yieldTransport
  runState.value = null
  werkYields.value = 0
  werkWorstSliceMs.value = 0
  werkSliceP95Ms.value = 0
  werkOverBudgetSlices.value = 0
  searchHandle.value?.cancel()
  searchHandle.value = null

  try {
    await nextFrame()

    if (entries.length === 0) return

    if (activeMode === 'only') {
      const onMetrics = await measureOn()
      runState.value = {
        query: queryAtStart,
        records: entries.length,
        budgetMs: dials.budgetMs,
        limit: dials.resultLimit,
        transport: transportAtStart,
        cards: [onCard(onMetrics)],
      }
      return
    }

    blocking.value = true
    await nextFrame()
    const offMetrics = await measureMainThread(() => {
      result.value = searchCatalog(queryAtStart, dials.resultLimit, entries)
    })
    blocking.value = false

    if (activeMode === 'off') {
      runState.value = {
        query: queryAtStart,
        records: entries.length,
        budgetMs: dials.budgetMs,
        limit: dials.resultLimit,
        transport: transportAtStart,
        cards: [offCard(offMetrics)],
      }
      return
    }

    await nextFrame()
    const onMetrics = await measureOn()
    runState.value = {
      query: queryAtStart,
      records: entries.length,
      budgetMs: dials.budgetMs,
      limit: dials.resultLimit,
      transport: transportAtStart,
      cards: [onCard(onMetrics), offCard(offMetrics)],
    }
  } catch (cause) {
    console.error('search run failed', cause)
  } finally {
    blocking.value = false
    modeRunning.value = false
    if (rerunQueued.value) {
      rerunQueued.value = false
      if (rebuildQueued) {
        rebuildQueued = false
        void (async () => {
          if (await ensureCatalog()) await runMode()
        })()
      } else {
        void runMode()
      }
    }
  }
}

const ingestCount = ref(0)
const ingestPreview = shallowRef<DemoRow[]>([])
const ingestProgress = ref<{ completed: number; total: number } | null>(null)
const ingestElapsedMs = ref<number | null>(null)
const ingesting = ref(false)
const ingestCancelled = ref(false)
const ingestRowsSource = computed(() => makeRows(dials.ingestRows))
let ingestController: AbortController | null = null

const ingestPercent = computed(() => {
  const progress = ingestProgress.value
  if (progress === null) return null
  return Math.round((progress.completed / progress.total) * 100)
})
const ingestPercentLabel = computed(() =>
  ingestPercent.value === null ? '—' : `${ingestPercent.value}%`,
)
const ingestElapsedLabel = computed(() => formatMs(ingestElapsedMs.value))

async function runIngest(): Promise<void> {
  ingestController?.abort()
  const controller = new AbortController()
  ingestController = controller
  ingestCount.value = 0
  ingestPreview.value = []
  ingestProgress.value = null
  ingestElapsedMs.value = null
  ingestCancelled.value = false
  ingesting.value = true
  const started = performance.now()

  try {
    const outcome = await runtime.value.ingest(
      ingestRowsSource.value,
      (batch) => {
        ingestCount.value += batch.length
        ingestPreview.value = [...ingestPreview.value, ...batch].slice(0, 8)
      },
      {
        signal: controller.signal,
        budgetMs: dials.budgetMs,
        maxBatchSize: dials.ingestBatchSize,
        onProgress: (progress) => {
          if (progress.kind === 'determinate') {
            ingestProgress.value = {
              completed: progress.completed,
              total: progress.total,
            }
          }
        },
      },
    )
    ingestElapsedMs.value = performance.now() - started
    ingestCancelled.value = outcome.cancelled
  } catch (cause) {
    console.error('ingest failed', cause)
  } finally {
    if (ingestController === controller) {
      ingestController = null
      ingesting.value = false
    }
  }
}

function cancelIngest(): void {
  ingestController?.abort()
}

function formatMs(value: number | null): string {
  if (value === null) return '—'
  return value < 10 ? `${value.toFixed(1)} ms` : `${value.toFixed(0)} ms`
}

function setMode(next: Mode): void {
  if (busy.value || mode.value === next) return
  window.clearTimeout(debounceTimer)
  window.clearTimeout(rerunTimer)
  mode.value = next
  void runMode()
}

function setTransport(next: YieldTransport): void {
  if (busy.value || dials.yieldTransport === next) return
  dials.yieldTransport = next
}

function resetDials(): void {
  Object.assign(dials, DEFAULT_DIALS)
}

const modeNoteText = computed(() => {
  if (dials.recordCount > 600_000) {
    return 'Large catalogue: expect a longer rebuild and a bigger heap.'
  }
  return modeNote.value
})

const transportHintText = computed(() => transportHint(dials.yieldTransport))

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let rerunTimer: ReturnType<typeof setTimeout> | undefined
let rebuildQueued = false

/**
 * Dials apply on the next search. A record-count change rebuilds the catalogue first; every
 * other dial reruns the current mode. The short delay lets a slider settle before the expensive
 * work starts.
 */
function scheduleAutoRun(rebuild: boolean, delayMs = 160): void {
  dialPending.value = true
  window.clearTimeout(rerunTimer)
  rerunTimer = window.setTimeout(() => {
    void (async () => {
      dialPending.value = false

      if (modeRunning.value) {
        rerunQueued.value = true
        if (rebuild) rebuildQueued = true
        return
      }

      if (rebuild) {
        const ready = await ensureCatalog()
        if (!ready) return
      }

      await runMode()
    })()
  }, delayMs)
}

watch(query, () => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    if (busy.value) {
      rerunQueued.value = true
      return
    }
    void runMode()
  }, 150)
})

watch(
  () => [dials.recordCount, dials.budgetMs, dials.resultLimit, dials.yieldTransport] as const,
  (next, previous) => {
    if (previous === undefined) return
    if (next[0] !== previous[0]) {
      scheduleAutoRun(true, 300)
      return
    }
    scheduleAutoRun(false)
  },
)

onMounted(() => {
  void (async () => {
    const ready = await ensureCatalog()
    if (ready) await runMode()
  })()
})

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer)
  window.clearTimeout(rerunTimer)
  ingestController?.abort()
  searchHandle.value?.cancel()
  activeBuild.value?.cancel()
})
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="eyebrow">@werk/core · sandbox</div>
      <h1>Frame budget, demonstrated.</h1>
      <p class="lede">
        Two compute-heavy examples running on the main thread. The left panel searches
        {{ dials.recordCount.toLocaleString() }} nested records with a {{ dials.budgetMs }} ms
        cooperative budget. The right panel applies {{ dials.ingestRows.toLocaleString() }} rows in
        bounded slices. The dials adjust those defaults; switch modes to compare the same work with
        and without werk.
      </p>
      <div class="stats">
        <div class="stat">
          <strong>{{ dials.recordCount.toLocaleString() }}</strong>
          <span>nested records</span>
        </div>
        <div class="stat">
          <strong>{{ dials.ingestRows.toLocaleString() }}</strong>
          <span>ingest rows</span>
        </div>
        <div class="stat">
          <strong>{{ dials.budgetMs }} ms</strong>
          <span>cooperative budget</span>
        </div>
      </div>
    </header>

    <section class="card dials" aria-labelledby="dials-heading">
      <div class="card-head">
        <div>
          <h2 id="dials-heading">Dials</h2>
          <p>
            Adjust the defaults the demos run with. A change reruns the last search; changing the
            record count rebuilds the catalogue cooperatively first.
          </p>
        </div>
        <button
          class="button ghost"
          type="button"
          :disabled="busy || isDefaultDials(dials)"
          @click="resetDials"
        >
          Reset to defaults
        </button>
      </div>

      <div class="dial-grid">
        <DialControl
          v-model="dials.budgetMs"
          label="Slice budget"
          :min="DIAL_RANGES.budgetMs.min"
          :max="DIAL_RANGES.budgetMs.max"
          :step="DIAL_RANGES.budgetMs.step"
          :display="`${dials.budgetMs} ms`"
          hint="How long werk works before yielding. Default 5 ms."
          :disabled="busy"
        />
        <DialControl
          v-model="dials.recordCount"
          label="Catalogue records"
          :min="DIAL_RANGES.recordCount.min"
          :max="DIAL_RANGES.recordCount.max"
          :step="DIAL_RANGES.recordCount.step"
          :display="`${dials.recordCount.toLocaleString()} records`"
          hint="Default 600,000. Rebuilds the catalogue, then reruns."
          :disabled="busy"
        />
        <DialControl
          v-model="dials.resultLimit"
          label="Result limit"
          :min="DIAL_RANGES.resultLimit.min"
          :max="DIAL_RANGES.resultLimit.max"
          :step="DIAL_RANGES.resultLimit.step"
          :display="`${dials.resultLimit} hits`"
          hint="Bounded top-K heap size. Default 100."
          :disabled="busy"
        />
        <DialControl
          v-model="dials.ingestRows"
          label="Ingest rows"
          :min="DIAL_RANGES.ingestRows.min"
          :max="DIAL_RANGES.ingestRows.max"
          :step="DIAL_RANGES.ingestRows.step"
          :display="`${dials.ingestRows.toLocaleString()} rows`"
          hint="Rows applied by ingest. Default 15,000."
          :disabled="ingesting"
        />
        <DialControl
          v-model="dials.ingestBatchSize"
          label="Ingest batch"
          :min="DIAL_RANGES.ingestBatchSize.min"
          :max="DIAL_RANGES.ingestBatchSize.max"
          :step="DIAL_RANGES.ingestBatchSize.step"
          :display="`${dials.ingestBatchSize.toLocaleString()} / slice`"
          hint="Max rows committed per slice. Default 400."
          :disabled="ingesting"
        />
      </div>

      <div class="transport-dial">
        <span class="dial-label">Yield transport</span>
        <div class="mode-switch transport-switch" role="group" aria-label="Yield transport">
          <button
            v-for="option in YIELD_TRANSPORTS"
            :key="option.value"
            type="button"
            class="mode-option"
            :class="{ active: dials.yieldTransport === option.value }"
            :aria-pressed="dials.yieldTransport === option.value"
            :disabled="busy"
            @click="setTransport(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <span class="dial-hint">{{ transportHintText }}</span>
      </div>

      <div v-if="building" class="progress dial-progress">
        <div class="bar" :class="{ indeterminate: buildPercent === null }">
          <span
            :style="buildPercent === null ? undefined : { width: `${buildPercent}%` }"
          ></span>
        </div>
        <div class="progress-meta">
          <span>{{ buildPercent === null ? 'building catalogue' : `${buildPercent}%` }}</span>
          <span v-if="buildCompleted !== null && buildTotal !== null">
            {{ buildCompleted.toLocaleString() }} / {{ buildTotal.toLocaleString() }}
          </span>
        </div>
      </div>

      <p v-if="buildError" class="error">{{ buildError }}</p>

      <p class="dial-footnote">
        The catalogue is generated in the browser: 600,000 records is roughly half a gigabyte of
        heap. Bigger sizes cost more memory and a longer rebuild.
        <span v-if="builtSize > 0">Built: {{ builtSize.toLocaleString() }} records.</span>
      </p>
    </section>

    <main class="grid">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Fuzzy search</h2>
            <p>Subsequence scoring across title, author, tags, and summary.</p>
          </div>
          <span class="badge">werk.task</span>
        </div>

        <div class="mode-switch" role="group" aria-label="Execution mode">
          <button
            v-for="option in MODE_OPTIONS"
            :key="option.value"
            type="button"
            class="mode-option"
            :class="{ active: mode === option.value }"
            :aria-pressed="mode === option.value"
            :disabled="busy"
            @click="setMode(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <p class="mode-note">
          {{ rerunQueued ? 'Query changed — another run is queued.' : modeNoteText }}
        </p>

        <label class="field">
          <span>Query</span>
          <input
            v-model="query"
            type="search"
            placeholder="Try “sil”, “atlas”, or “glass”"
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <div class="actions">
          <button class="button primary" :disabled="busy" @click="runMode">
            {{ modeRunning ? 'Running…' : runLabel }}
          </button>
        </div>

        <FrameTimeChart />

        <div v-if="modeRunning || (searchPercent !== null && mode !== 'off')" class="progress">
          <div class="bar" :class="{ indeterminate: searchPercent === null || blocking }">
            <span
              :style="
                searchPercent === null || blocking ? undefined : { width: `${searchPercent}%` }
              "
            ></span>
          </div>
          <div class="progress-meta">
            <span>{{
              blocking ? 'blocking' : searchPercent === null ? 'yielding' : `${searchPercent}%`
            }}</span>
            <span v-if="!blocking && searchCompleted !== null && searchTotal !== null">
              {{ searchCompleted.toLocaleString() }} / {{ searchTotal.toLocaleString() }}
            </span>
          </div>
        </div>

        <p v-if="searchError" class="error">{{ searchError }}</p>

        <div class="meta">
          <span><strong>{{ totalMatches.toLocaleString() }}</strong> matches</span>
          <span class="muted">mode: {{ currentModeLabel }}</span>
          <span v-if="werkYields > 0">{{ werkYields }} yields</span>
        </div>

        <div v-if="runState" class="comparison">
          <div class="comparison-head">
            <div>
              <span class="eyebrow">{{ runTitle }}</span>
              <span class="muted"
                >query “{{ runState.query }}” · {{ runState.budgetMs }} ms budget ·
                top {{ runState.limit }} · {{ transportLabel(runState.transport) }} yield</span
              >
            </div>
            <span class="badge">{{ runState.records.toLocaleString() }} records</span>
          </div>

          <div class="comparison-grid" :class="{ single: runState.cards.length === 1 }">
            <article
              v-for="card in runState.cards"
              :key="card.id"
              class="compare-card"
              :class="card.id"
            >
              <header>
                <strong>{{ card.title }}</strong>
                <span class="compare-tag">{{ card.tag }}</span>
              </header>
              <dl>
                <div>
                  <dt>total</dt>
                  <dd>{{ formatMs(card.metrics.elapsedMs) }}</dd>
                </div>
                <div>
                  <dt>long tasks</dt>
                  <dd>{{ card.metrics.longTasks }}</dd>
                </div>
                <div>
                  <dt>worst frame</dt>
                  <dd>{{ formatMs(card.metrics.worstFrameMs) }}</dd>
                </div>
                <div v-if="card.worstSliceMs !== null">
                  <dt>p95 slice</dt>
                  <dd>{{ formatMs(card.sliceP95Ms) }}</dd>
                </div>
                <div v-if="card.worstSliceMs !== null">
                  <dt>worst slice</dt>
                  <dd>
                    {{ formatMs(card.worstSliceMs) }}
                    <span v-if="(card.overBudgetSlices ?? 0) > 0" class="over-budget">
                      {{ card.overBudgetSlices }} over
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>yields</dt>
                  <dd>{{ card.yields }}</dd>
                </div>
              </dl>
              <div class="meter">
                <span :style="{ width: frameWidth(card.metrics.worstFrameMs) }"></span>
              </div>
              <div v-if="card.worstSliceMs !== null" class="slice-meter">
                <span class="slice-meter-label">worst slice vs {{ card.budgetMs }} ms budget</span>
                <div class="meter slice" :class="{ over: (card.overBudgetSlices ?? 0) > 0 }">
                  <span :style="{ width: sliceWidth(card) }"></span>
                </div>
              </div>
            </article>
          </div>

          <p class="comparison-note">{{ runNote }}</p>
        </div>

        <ul class="results">
          <li v-for="hit in hits" :key="hit.entry.id" class="result">
            <div>
              <strong>{{ hit.entry.title }}</strong>
              <span class="result-meta">
                {{ hit.entry.author.name }} · {{ hit.entry.metadata.year }} ·
                {{ hit.entry.metadata.language }}
              </span>
              <span class="tag-row">
                <span v-for="tag in hit.entry.tags.slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
              </span>
            </div>
            <span class="score">{{ hit.score }}</span>
          </li>
        </ul>
        <p v-if="hits.length === 0" class="empty">No results yet. Run a search.</p>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Budgeted ingestion</h2>
            <p>Apply generated rows to Vue state without one long commit.</p>
          </div>
          <span class="badge">werk.ingest</span>
        </div>

        <div class="ingest-summary">
          <div>
            <strong>{{ ingestCount.toLocaleString() }}</strong>
            <span class="summary-label">rows applied</span>
          </div>
          <div>
            <strong>{{ ingestElapsedLabel }}</strong>
            <span class="summary-label">elapsed</span>
          </div>
          <div>
            <strong>{{ ingestPercentLabel }}</strong>
            <span class="summary-label">progress</span>
          </div>
        </div>

        <div class="actions">
          <button class="button primary" :disabled="ingesting" @click="runIngest">
            {{ ingesting ? 'Ingesting…' : `Ingest ${dials.ingestRows.toLocaleString()} rows` }}
          </button>
          <button v-if="ingesting" class="button ghost" @click="cancelIngest">Cancel</button>
        </div>

        <div v-if="ingestPercent !== null" class="progress">
          <div class="bar">
            <span :style="{ width: `${ingestPercent}%` }"></span>
          </div>
        </div>

        <p v-if="ingestCancelled" class="notice">Cancelled. Committed batches stay applied.</p>

        <table class="preview">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Region</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ingestPreview" :key="row.id">
              <td>{{ row.sku }}</td>
              <td>{{ row.region }}</td>
              <td>{{ row.amount.toFixed(2) }}</td>
              <td><span class="status" :class="row.status">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="ingestPreview.length === 0" class="empty">Apply rows to see a preview.</p>
      </section>
    </main>

    <footer class="footer">
      <span>werk owns the frame budget for work crossing its boundary.</span>
      <span>Vue, layout, paint, and GC remain outside it.</span>
    </footer>
  </div>
</template>
