#!/usr/bin/env node
// Read-view image probe. Drives the scaffold server like drive.mjs (mock
// via addInitScript) and exercises the reported Gmail-vs-Mailsy
// divergence: a body image authored at 3000px must shrink-fit the
// reading pane with its aspect ratio kept, text must flow below it, and
// a small image in the same body must never upscale.
// Usage: node drive/read-image-probe.mjs [port]
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(here, '..')
const MOCK = resolve(SKILL_DIR, 'fixtures/api-mock.js')
const PORT = process.argv[2] ?? '4317'

const browser = await chromium.launch()
const context = await browser.newContext()
await context.addInitScript({ path: MOCK })
const page = await context.newPage()
let failures = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail.slice(0, 160)}` : ''}`)
  if (!ok) failures += 1
}

await page.goto(`http://127.0.0.1:${PORT}/`)
const inbox = page.getByRole('complementary', { name: 'Inbox' })
await inbox.waitFor({ timeout: 10000 })
await inbox.getByText('Beluga whale photo').first().click()
const frame = page.frameLocator('iframe[title="Email content msg-wide-img"]')
const wide = frame.locator('img[alt="beluga whale swimming"]')
await wide.waitFor({ timeout: 10000 })
// Give the images a beat to decode so widths reflect real layout.
await page.waitForTimeout(300)

// Pane width: the iframe's own client box is the reading pane the image
// must fit, so measure it once and reuse it for the crop check.
const layout = await page.evaluate(() => {
  const frame = document.querySelector('iframe[title="Email content msg-wide-img"]')
  const doc = frame?.contentDocument
  if (!doc) return null
  const wide = doc.querySelector('img[alt="beluga whale swimming"]')
  const small = doc.querySelector('img[alt="small stamp"]')
  const ratio = (a, b) => Number((a / b).toFixed(3))
  return {
    pane: frame.clientWidth,
    wide: wide ? { w: wide.clientWidth, h: wide.clientHeight, natural: ratio(wide.naturalWidth, wide.naturalHeight) } : null,
    small: small ? { w: small.clientWidth } : null,
    scrollW: doc.documentElement.scrollWidth,
    bodyScrollW: doc.body.scrollWidth,
    text: doc.body.innerText
  }
})
check(layout !== null, 'the message iframe exposes its document', 'contentDocument was null')
if (layout) {
  check(
    layout.wide !== null && layout.wide.w <= layout.pane + 1,
    'the 3000px image shrink-fits the pane width',
    `img=${layout.wide?.w} pane=${layout.pane}`
  )
  check(
    layout.wide !== null &&
      Math.abs(ratioOf(layout.wide.w, layout.wide.h) - layout.wide.natural) < 0.05,
    'the fit keeps the image aspect ratio',
    `rendered ${(layout.wide.w / layout.wide.h).toFixed(3)} vs natural ${layout.wide.natural}`
  )
  check(
    layout.scrollW <= layout.pane + 1 && layout.bodyScrollW <= layout.pane + 1,
    'nothing overflows horizontally, so no edge crop like the report',
    `scroll=document:${layout.scrollW} body:${layout.bodyScrollW} pane=${layout.pane}`
  )
  check(
    layout.text.includes('beluga whale') && layout.text.includes('its a beluga whale lol'),
    'text below the image still renders',
    JSON.stringify(layout.text.slice(0, 120))
  )
  check(
    layout.small !== null && layout.small.w === 60,
    'the small image keeps its authored size instead of upscaling',
    `small=${layout.small?.w}`
  )
}

function ratioOf(a, b) {
  return b === 0 ? 0 : a / b
}

console.log(failures === 0 ? 'PROBE: all pass' : `PROBE: ${failures} failing`)
await page.screenshot({ path: resolve(SKILL_DIR, 'artifacts/read-image-probe.png') })
await browser.close()
process.exit(failures === 0 ? 0 : 1)
