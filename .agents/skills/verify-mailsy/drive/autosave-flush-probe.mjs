#!/usr/bin/env node
// Probe for the send-vs-autosave flush race (feature id autosave-flush).
// Drives the real compose UI, but the boundary's saveDraft reply is gated:
// a save stays in flight until released, so "Send pressed while a debounced
// drafts.create is still flying" is deterministic instead of a ~ms window.
// Expectations: pre-fix code leaves a lingering draft (lingering), fixed
// code consumes it (consumed). Usage:
//   node autosave-flush-probe.mjs <port> [--expect consumed|lingering]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdout } from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(here, '..')
const MOCK = resolve(SKILL_DIR, 'fixtures/api-mock.js')
const PORT = process.argv[2] ?? '4317'
const EXPECT_I = process.argv.indexOf('--expect')
const EXPECT = EXPECT_I === -1 ? null : (process.argv[EXPECT_I + 1] ?? null)
const ART = resolve(SKILL_DIR, 'artifacts', process.env.RUN_ID ?? 'flush-race')
mkdirSync(ART, { recursive: true })

const step = (c) => stdout.write(`${c}\n`)
const lines = []
const log = (m) => { lines.push(m); stdout.write(`${m}\n`) }
function assert(cond, okMsg, failMsg) {
  if (!cond) throw new Error(`ASSERT: ${failMsg}`)
  log(`pass: ${okMsg}`)
}

// Runs after the api-mock init script. Gates every saveDraft call: the
// request counts as dispatched before the hold, recorded after the release.
const GATE = `(() => {
  const original = window.api.saveDraft
  const probe = { dispatched: 0, resolved: 0, released: false, gate: true }
  window.__flushProbe = probe
  window.api.saveDraft = async (request) => {
    probe.dispatched++
    if (probe.gate) {
      probe.held = true
      await new Promise((release) => { probe.release = release })
      probe.held = false
    }
    const draftId = await original(request)
    probe.resolved++
    return draftId
  }
})()`

const browser = await chromium.launch()
const context = await browser.newContext()
await context.addInitScript({ path: MOCK })
await context.addInitScript(GATE)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})

const shot = async (name) => {
  writeFileSync(resolve(ART, `autosave-flush-${name}.aria.txt`), `feature: autosave-flush\nentry: http://127.0.0.1:${PORT}/\n${await page.locator('body').ariaSnapshot()}\n`)
  await page.screenshot({ path: resolve(ART, `autosave-flush-${name}.png`) })
}
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  step(`goto http://127.0.0.1:${PORT}/`)
  await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
  const content = page.getByRole('region', { name: 'Email content' })

  // Type the compose. The last keystroke starts the ~1.2s debounce, which
  // fires and dispatches the save; the gate keeps the reply in flight.
  await page.getByRole('button', { name: 'Compose', exact: true }).click()
  await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
  await content.locator('.composerField input').first().fill('brook@example.com')
  await content.locator('.composerField input').nth(1).fill('Race window draft')
  await content.locator('.composerField textarea').fill('Typed inside the autosave window, then sent.')
  await page.waitForFunction(() => window.__flushProbe.dispatched === 1, undefined, { timeout: 10000 })
  assert(
    (await page.evaluate(() => (window.__draftSaves ?? []).length)) === 0,
    'save dispatched with its draft not yet recorded by the boundary (in flight, held)',
    'the flush race window did not open'
  )
  await shot('hold')

  // Send while the create is still flying: this is the reported race.
  await content.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForTimeout(500)
  const sentWhileHeld = (await content.getByText('Message sent.').count()) > 0
  const sentDuringHold = await page.evaluate(() => window.__sent ?? [])
  log(`observation: while the save is held, "Message sent." visible=${sentWhileHeld}, outbox=${JSON.stringify(sentDuringHold)}`)

  // Let the flying save land, then read the final state.
  await page.evaluate(() => window.__flushProbe.release())
  await content.getByText('Message sent.').waitFor({ timeout: 10000 })
  log(`probe: saves=${JSON.stringify(await page.evaluate(() => window.__draftSaves))}, sent=${JSON.stringify(await page.evaluate(() => window.__sent))}`)

  // The lingering-draft check: a fresh Drafts refetch must not show a draft
  // whose content went out in the send.
  await page.getByRole('button', { name: 'Drafts' }).click()
  const drafts = page.getByRole('complementary', { name: 'Drafts' })
  await drafts.waitFor({ timeout: 10000 })
  const lingering = await drafts.locator('li', { hasText: 'Race window draft' }).count()
  const draftSaves = await page.evaluate(() => window.__draftSaves)
  const sent = await page.evaluate(() => window.__sent)
  const usedDraftId = sent.some((s) => s.draftId)
  const verdict =
    usedDraftId && lingering === 0 ? 'consumed'
    : !usedDraftId && lingering === 1 && draftSaves.length === 1 ? 'lingering'
    : `inconsistent`
  log(`verdict: ${verdict} (sent records=${sent.length}, sent with draftId=${usedDraftId}, lingering draft rows=${lingering}, draft saves=${draftSaves.length})`)
  await shot('after')

  assert(
    verdict === 'consumed' || verdict === 'lingering',
    `race window verdict: ${verdict}`,
    `inconsistent race outcome: sent=${JSON.stringify(sent)} saves=${JSON.stringify(draftSaves)} lingering=${lingering}`
  )
  if (EXPECT) {
    assert(verdict === EXPECT, `code under test behaves as expected: ${EXPECT}`, `expected ${EXPECT} but observed ${verdict}`)
  }
} catch (e) {
  log(`FAIL ${e instanceof Error ? e.message : String(e)}`)
  if (errors.length) log(`errors=${JSON.stringify(errors.slice(0, 5))} (total ${errors.length})`)
  await shot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  writeFileSync(resolve(ART, 'autosave-flush.log'), `command: autosave-flush-probe.mjs ${PORT}${EXPECT ? ` --expect ${EXPECT}` : ''}\nbehavior under test: ${process.env.FLUSH_PROBE_CODE ?? 'unlabeled'}\n${lines.join('\n')}\n`)
  await browser.close()
}
