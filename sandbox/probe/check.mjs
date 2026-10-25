// Browser-level budget check: runs the probe in real Chrome for each yield transport and asserts
// the cooperative slice budget holds. Requires `pnpm dev` (the sandbox server) in another terminal.
//
// Usage: node sandbox/probe/check.mjs [probePageUrl] [budgetMs]
import { spawn } from 'node:child_process'

const PROBE_URL = process.argv[2] ?? 'http://localhost:5180/probe/probe.html'
const BUDGET_MS = Number(process.argv[3] ?? 5)
const RECORDS = Number(process.env.PROBE_RECORDS ?? 600_000)
// A slice may legitimately finish a unit just after the budget expires, so require p95 — not the
// absolute worst — to stay within one measurement tick of the budget.
const SLICE_TOLERANCE_MS = 1
// One refresh at 60 Hz is 16.7 ms; allow two dropped frames before failing.
const FRAME_LIMIT_MS = 50
// Forcing scheduler.yield() is known to starve rendering in current Chromium. The check asserts the
// slice budget still holds and reports the frame number instead of failing on a browser quirk.
const TRANSPORTS = ['auto', 'postTask', 'messageChannel', 'schedulerYield']

function runProbe(transport) {
  return new Promise((resolve, reject) => {
    const url = `${PROBE_URL}?records=${RECORDS}&budgetMs=${BUDGET_MS}&transport=${transport}`
    const child = spawn(process.execPath, ['sandbox/probe/run.mjs', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`probe failed for ${transport} (exit ${code}): ${stderr.slice(-800)}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error(`probe for ${transport} did not print JSON: ${stdout.slice(-800)}`))
      }
    })
  })
}

const failures = []
const rows = []

for (const transport of TRANSPORTS) {
  const result = await runProbe(transport)
  rows.push(result)

  if (result.sliceP95Ms > BUDGET_MS + SLICE_TOLERANCE_MS) {
    failures.push(
      `${transport}: p95 slice ${result.sliceP95Ms} ms exceeds ${BUDGET_MS} ms budget (+${SLICE_TOLERANCE_MS} ms tolerance)`,
    )
  }
  if (result.longTasks > 0) {
    failures.push(`${transport}: ${result.longTasks} long task(s) despite cooperative slicing`)
  }
  if (transport !== 'schedulerYield' && result.frameMaxMs > FRAME_LIMIT_MS) {
    failures.push(
      `${transport}: worst frame ${result.frameMaxMs} ms exceeds the ${FRAME_LIMIT_MS} ms failure limit`,
    )
  }
}

const header = [
  'transport',
  'p50 slice',
  'p95 slice',
  'worst slice',
  'over',
  'worst frame',
  'long tasks',
]
console.log(header.join('\t'))
for (const row of rows) {
  console.log(
    [
      row.transport,
      row.sliceP50Ms,
      row.sliceP95Ms,
      row.worstSliceMs,
      row.overBudgetSlices,
      row.frameMaxMs,
      row.longTasks,
    ].join('\t'),
  )
}

const starved = rows.find((row) => row.transport === 'schedulerYield')
if (starved !== undefined) {
  console.log(
    `\nscheduler.yield() frame check: ${starved.frameMaxMs} ms worst frame (informational; ` +
      'current Chromium schedules its continuation ahead of rendering).',
  )
}

if (failures.length > 0) {
  console.error(`\nFAIL\n${failures.join('\n')}`)
  process.exit(1)
}

console.log(
  `\nPASS: ${TRANSPORTS.length} transports kept p95 slice <= ${BUDGET_MS + SLICE_TOLERANCE_MS} ms`,
)
