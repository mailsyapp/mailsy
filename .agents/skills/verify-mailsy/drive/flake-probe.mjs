#!/usr/bin/env node
// Probe for the intermittent "row never detached after delete" failure.
// Runs the delete journey's actions in a loop; on any failure dumps page
// state (mods, role=alert text, button states) to name the cause.
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdout } from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const MOCK = resolve(here, '..', 'fixtures/api-mock.js')
const PORT = process.argv[2] ?? '4352'
const ROUNDS = Number(process.argv[3] ?? '15')

const log = (m) => stdout.write(`${m}\n`)

let failures = 0
for (let round = 1; round <= ROUNDS; round++) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addInitScript({ path: MOCK })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  let mods = 'none'
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await page
      .getByRole('region', { name: 'Email content' })
      .getByRole('button', { name: 'delete', exact: true })
      .click()
    await inbox
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 5000 })
    mods = await page.evaluate(() => window.__mods)
    // Duplicate-key warnings are the seed of the stale-append flake; a
    // round that detaches the row but rendered duplicates still fails.
    const dupErrors = errors.filter((e) => e.includes('same key'))
    if (dupErrors.length > 0) throw new Error(`DUPKEYS: ${dupErrors.length} duplicate-key warnings`)
    log(`round ${round}: pass`)
  } catch (e) {
    failures++
    mods = JSON.stringify(mods)
    const alert = await page.locator('p[role="alert"]').allTextContents().catch(() => ['?'])
    const rows = await page
      .$$eval('ul.emails li strong', (els) => els.map((el) => el.textContent))
      .catch(() => [])
    log(`round ${round}: FAIL ${e instanceof Error ? e.message : String(e)}`)
    log(`  mods=${mods}`)
    log(`  alerts=${JSON.stringify(alert)}`)
    log(`  rows=${JSON.stringify(rows)}`)
    log(`  errors=${JSON.stringify(errors.slice(0, 3))} (total ${errors.length})`)
  }
  await browser.close()
}
log(`RESULT failures=${failures}/${ROUNDS}`)
