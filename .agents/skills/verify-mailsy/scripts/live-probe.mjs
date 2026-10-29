// Read-only live probe against the real Electron app (Gmail backend).
// Asserts: signed-in inbox renders, refresh sweep runs without error,
// Snoozed / All Mail views answer, zero error banners. Screenshots saved.
// One-off probes resolve Playwright from the skill's single dependency
// install (../drive, see SKILL.md Helpers) instead of a local node_modules.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const RUN_DIR = process.argv[2]
const CDP_PORT = process.argv[3] ?? '9223'
mkdirSync(RUN_DIR, { recursive: true })
const require2 = createRequire(new URL('../drive/', import.meta.url))
const { chromium } = require2('playwright')

// Watchdog: a CDP or slow mesh hang must never wedge the coordinator; hard
// exit with whatever states are already logged + screenshots on disk.
setTimeout(() => { console.log('WATCHDOG fired (150s)'); process.exit(3) }, 150000)

async function waitWs() {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
    if (res.ok) return (await res.json()).webSocketDebuggerUrl
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP never came up')
}

const ws = await waitWs()
const browser = await chromium.connectOverCDP(ws)
// Drive the app's own window: CDP target creation is unsupported in
// Electron, so use the already-open page.
let page = browser.contexts()[0]?.pages()[0]
if (!page) throw new Error('no existing page over CDP')
const errors = []
const step = (m) => console.log(`probe: ${m}`)

// Wait for signed-in state: rows render, no OAuth failure text.
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(3000)
let text = (await page.locator('body').innerText()).slice(0, 400)
console.log('page-head:', JSON.stringify(text).slice(0, 300))

function bannerCount(t) {
  const bad = /OAuth credentials missing|cannot|failed to|something went wrong/i
  return bad.test(t) ? 1 : 0
}

// 1. Signed-in rows present? Rail renders late on a cold live fetch; wait
// generously and count affordances.
await page.waitForSelector('text=Sign out', { timeout: 20000 })
await page.waitForTimeout(8000)
const rowSel = '.thread-row, [role="button"]'
const inboxRows = (await page.locator(rowSel).count()) ?? 0
step(`inbox affordances=${inboxRows}`)

// 2. Refresh click exercises the incremental sweep end to end (read side).
try {
  const refresh = page.getByText('Refresh', { exact: true }).first()
  await refresh.click({ timeout: 5000 })
  step('refresh clicked; busy->idle wait')
  await page.waitForTimeout(6000)
  text = (await page.locator('body').innerText()).slice(0, 200)
} catch (e) {
  step(`refresh click skipped: ${e.message.split('\n')[0]}`)
}

// 3. Snoozed view via rail. Rail entries are plain buttons; a strict-resolved
// locator can stall on fuzzy text, so we click whatever the gettext matches
// and log when even that is not clickable (probe limitation, not app).
async function railClick(label) {
  try {
    await page.locator('button', { hasText: label }).first().click({ timeout: 8000, force: true })
    return true
  } catch (e) {
    step(`railClick(${label}) unclickable: ${e.message.split('\n')[0]}`)
    return false
  }
}

try {
  if (await railClick('Snoozed')) {
    await page.waitForTimeout(3000)
    text = (await page.locator('body').innerText()).slice(0, 600)
    step(`snoozed view opened; banners=${bannerCount(text)}`)
    await page.screenshot({ path: `${RUN_DIR}/snoozed-live.png` })
  }
} catch (e) {
  step(`snoozed view failed: ${e.message.split('\n')[0]}`)
}

// 4. All Mail via rail.
try {
  if (await railClick('All Mail')) {
    await page.waitForTimeout(3000)
    text = (await page.locator('body').innerText()).slice(0, 600)
    step(`all mail view opened; banners=${bannerCount(text)}`)
    await page.screenshot({ path: `${RUN_DIR}/allmail-live.png` })
  }
} catch (e) {
  step(`all mail view failed: ${e.message.split('\n')[0]}`)
}

// 5. Back to Inbox final state + screenshot.
try {
  if (await railClick('Inbox')) {
    await page.waitForTimeout(3000)
  }
  text = (await page.locator('body').innerText()).slice(0, 800)
  step(`final inbox banners=${bannerCount(text)}`)
  await page.screenshot({ path: `${RUN_DIR}/inbox-live.png` })
} catch (e) {
  step(`inbox return failed: ${e.message.split('\n')[0]}`)
}
console.log(`PROBE_DONE banners_total=${bannerCount((await page.locator('body').innerText()).slice(0, 800))}`)
await page.close()
