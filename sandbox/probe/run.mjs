// Minimal zero-dependency CDP driver: launches Chrome, loads the probe page, prints its result.
//
// Usage:
//   node sandbox/probe/run.mjs 'http://localhost:5180/probe/probe.html?records=600000&budgetMs=5'
//
// CHROME_BIN overrides the browser binary, CDP_PORT the DevTools port.
import { spawn } from 'node:child_process'

const CHROME = process.env.CHROME_BIN ?? 'google-chrome-stable'
const PORT = Number(process.env.CDP_PORT ?? 9333)
const PAGE_URL = process.argv[2] ?? 'http://localhost:5180/probe/probe.html'
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 180_000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/chrome-werk-probe',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function waitForJson(path, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(100)
  }
  throw new Error(`Chrome DevTools endpoint not reachable at ${path}`)
}

class Cdp {
  #ws
  #nextId = 0
  #pending = new Map()
  #listeners = new Set()

  static async connect(webSocketDebuggerUrl) {
    const cdp = new Cdp()
    cdp.#ws = new WebSocket(webSocketDebuggerUrl)
    cdp.#ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const handler = cdp.#pending.get(message.id)
        cdp.#pending.delete(message.id)
        handler?.(message)
        return
      }
      for (const listener of cdp.#listeners) listener(message)
    })
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener('open', resolve, { once: true })
      cdp.#ws.addEventListener('error', reject, { once: true })
    })
    return cdp
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#nextId
    const payload = { id, method, params }
    if (sessionId !== undefined) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (message) => {
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        else resolve(message.result)
      })
      this.#ws.send(JSON.stringify(payload))
    })
  }

  onEvent(listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  waitForEvent(method, sessionId) {
    return new Promise((resolve) => {
      const unsubscribe = this.onEvent((message) => {
        if (
          message.method === method &&
          (sessionId === undefined || message.sessionId === sessionId)
        ) {
          unsubscribe()
          resolve(message.params)
        }
      })
    })
  }

  close() {
    this.#ws.close()
  }
}

try {
  const version = await waitForJson('/json/version')
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl)

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)

  const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId)
  await cdp.send('Page.navigate', { url: PAGE_URL }, sessionId)
  await loaded

  const expression = 'window.__PROBE_RESULT__ ?? null'
  const deadline = Date.now() + TIMEOUT_MS
  let result

  while (Date.now() < deadline) {
    const reply = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    )
    if (reply.exceptionDetails) {
      throw new Error(`Page threw: ${reply.exceptionDetails.exception?.description}`)
    }
    if (reply.result?.value !== null && reply.result?.value !== undefined) {
      result = reply.result.value
      break
    }
    await sleep(250)
  }

  if (result === undefined) throw new Error('probe timed out')
  console.log(JSON.stringify(result, null, 2))
  cdp.close()
} finally {
  chrome.kill('SIGKILL')
}
