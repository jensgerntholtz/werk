// Drives the sandbox UI in headless Chrome and prints what the run panel reports.
// Usage: node sandbox/probe/app.mjs [url] [modeLabel]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const CHROME = process.env.CHROME_BIN ?? 'google-chrome-stable'
const PORT = Number(process.env.CDP_PORT ?? 9334)
const PAGE_URL = process.argv[2] ?? 'http://localhost:5180/'
const MODE = process.argv[3] ?? 'Werk Only'
const SCREENSHOT = process.env.SHOT
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
    '--window-size=1280,2200',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/chrome-werk-app',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function version() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (response.ok) return await response.json()
    } catch {}
    await sleep(100)
  }
  throw new Error('no devtools')
}

class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  #listeners = new Set()

  static async connect(url) {
    const cdp = new Cdp()
    cdp.#ws = new WebSocket(url)
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
    const id = ++this.#id
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

function evaluate(cdp, sessionId, expression) {
  return cdp
    .send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    .then((reply) => {
      if (reply.exceptionDetails) {
        throw new Error(reply.exceptionDetails.exception?.description ?? 'eval failed')
      }
      return reply.result?.value
    })
}

try {
  const info = await version()
  const cdp = await Cdp.connect(info.webSocketDebuggerUrl)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId)
  await cdp.send('Page.navigate', { url: PAGE_URL }, sessionId)
  await loaded

  // Wait until the first catalogue build and run finished (mode buttons enabled).
  await evaluate(
    cdp,
    sessionId,
    `(async()=>{const t=performance.now()+120000; while(performance.now()<t){const b=document.querySelector('.mode-option'); if(b && !b.disabled) return true; await new Promise(r=>setTimeout(r,200))} return false})()`,
  )

  const clicked = await evaluate(
    cdp,
    sessionId,
    `(()=>{const b=[...document.querySelectorAll('.mode-option')].find(x=>x.textContent.trim()===${JSON.stringify(MODE)}); if(!b) return 'missing'; b.click(); return 'clicked'})()`,
  )

  await evaluate(
    cdp,
    sessionId,
    `(async()=>{const t=performance.now()+120000; while(performance.now()<t){const c=document.querySelector('.comparison'); const buttons=[...document.querySelectorAll('button')]; const idle=buttons.some(b=>!b.disabled && /Run werk (only|off)|Compare werk/.test(b.textContent)); if(c && idle){await new Promise(r=>setTimeout(r,1200)); return true} await new Promise(r=>setTimeout(r,200))} return false})()`,
  )

  const searchReport = await evaluate(
    cdp,
    sessionId,
    `(()=>({
      comparison: document.querySelector('.comparison')?.innerText ?? null,
      chartHead: document.querySelector('.frame-chart-head')?.innerText ?? null,
      overBudgetBadges: [...document.querySelectorAll('.over-budget')].map((n) => n.innerText),
    }))()`,
  )

  const ingestClicked = await evaluate(
    cdp,
    sessionId,
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Ingest /.test(x.textContent.trim())); if(!b) return 'missing'; b.click(); return 'clicked'})()`,
  )

  const ingestReport = await evaluate(
    cdp,
    sessionId,
    `(async()=>{const t=performance.now()+60000; while(performance.now()<t){const b=[...document.querySelectorAll('button')].find(x=>/^Ingest /.test(x.textContent.trim())); if(b && !b.disabled){await new Promise(r=>setTimeout(r,800)); return {summary: document.querySelector('.ingest-summary')?.innerText ?? null, notice: document.querySelector('.notice')?.innerText ?? null}} await new Promise(r=>setTimeout(r,200))} return null})()`,
  )

  if (SCREENSHOT) {
    const shot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId,
    )
    writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }

  console.log(JSON.stringify({ clicked, searchReport, ingestClicked, ingestReport }, null, 2))
  cdp.close()
} finally {
  chrome.kill('SIGKILL')
}
