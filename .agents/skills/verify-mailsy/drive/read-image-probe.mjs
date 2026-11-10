#!/usr/bin/env node
// Read-view image probe. Drives the scaffold server like drive.mjs (mock
// via addInitScript) and exercises the reported Gmail-vs-Mailsy
// divergence: body images authored far wider than the reading pane must
// shrink-fit it (like Gmail) with the aspect ratio kept, whatever the
// sender markup family — plain attributes, inline styling, fixed-width
// layout tables, sender stylesheets — and a small authored image must
// never upscale. Usage: node drive/read-image-probe.mjs [port]
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

// The base thread pins the exact reported scenario plus the text-flow
// and no-upscale halves; every other family only needs the fit itself,
// because one rule styles the one iframe all of them render through.
async function measure(subject) {
  await inbox.getByText(subject, { exact: true }).first().click()
  const frame = page.locator('iframe[title^="Email content"]').last()
  await frame.waitFor({ timeout: 10000 })
  // Give the images a beat to decode so widths reflect real layout.
  await page.waitForTimeout(400)
  const m = await page.evaluate(() => {
    const frame = [...document.querySelectorAll('iframe[title^="Email content"]')].pop()
    const doc = frame?.contentDocument
    if (!doc) return null
    const img = doc.querySelector('img')
    return {
      pane: frame.clientWidth,
      imgW: img?.clientWidth ?? -1,
      imgH: img?.clientHeight ?? -1,
      natural: img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
      smallW: doc.querySelector('img[alt="small stamp"]')?.clientWidth ?? null,
      scrollW: doc.body.scrollWidth,
      text: doc.body.innerText
    }
  })
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await inbox.waitFor({ timeout: 10000 })
  return m
}

const families = [
  ['Beluga whale photo', 'img authored 3000x1500 with plain attributes'],
  ['Wide inline style', 'img with inline width styling'],
  ['Wide table layout', 'img inside a fixed-width table cell'],
  ['Wide important style', 'img with sender stylesheet width rules']
]
const previews = []
for (const [subject, family] of families) {
  const m = await measure(subject)
  const tag = m ? `img=${m.imgW} pane=${m.pane}` : 'no iframe document'
  check(m !== null, `${family}: the iframe exposes its document`, tag)
  if (!m) continue
  check(
    m.imgW <= m.pane + 1 && m.scrollW <= m.pane + 1,
    `${family}: the wide image shrink-fits the pane without edge crop (the report's signature)`,
    tag + ` scroll=${m.scrollW}`
  )
  const ratio = m.imgH === 0 ? 0 : m.imgW / m.imgH
  check(
    Math.abs(ratio - m.natural) < 0.05,
    `${family}: the fit keeps the image aspect ratio`,
    `rendered ${ratio.toFixed(3)} vs natural ${m.natural.toFixed(3)}`
  )
  previews.push({ subject, m })
}

const base = previews.find((p) => p.subject === 'Beluga whale photo')
if (base) {
  check(
    base.m.text.includes('beluga whale') && base.m.text.includes('its a beluga whale lol'),
    'text below the image still renders',
    JSON.stringify(base.m.text.slice(0, 120))
  )
  check(
    base.m.smallW === 60,
    'the small image keeps its authored size instead of upscaling',
    `small=${base.m.smallW}`
  )
}

console.log(failures === 0 ? 'PROBE: all pass' : `PROBE: ${failures} failing`)
await page.screenshot({ path: resolve(SKILL_DIR, 'artifacts/read-image-probe.png') })
await browser.close()
process.exit(failures === 0 ? 0 : 1)
