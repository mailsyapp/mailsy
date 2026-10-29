// Probe for the snooze affordance's surface coverage (feat/snooze-button):
// the park affordance rides every mail-ownership view the detail pane can
// open mail from, not just inbox/all/starred. Real renderer against the
// fixture mock, which supplies the category views to open mail from.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(here, '..')
const MOCK = resolve(SKILL_DIR, 'fixtures/api-mock.js')
const port = process.env.PROBE_PORT || '6712'
const art = resolve(SKILL_DIR, 'artifacts', process.env.PROBE_RUN_ID || 'snooze-surface-probe')
mkdirSync(art, { recursive: true })
const failures = []

function assert(cond, okMsg, failMsg) {
  if (cond) console.log(`pass: ${okMsg}`)
  else {
    console.log(`FAIL: ${failMsg}`)
    failures.push(failMsg)
  }
}

const browser = await chromium.launch()
const context = await browser.newContext()
await context.addInitScript({ path: MOCK })
const page = await context.newPage()
await page.goto(`http://127.0.0.1:${port}/`)
const content = page.getByRole('region', { name: 'Email content' })

// The rail button and the panel it opens share the exact accessible name,
// so one string selects both sides of each open.
async function openAndAssertSnooze(view, rowText) {
  await page.getByRole('button', { name: view, exact: true }).click()
  const list = page.getByRole('complementary', { name: view })
  await list.waitFor({ timeout: 10000 })
  await list.getByText(rowText, { exact: true }).first().click()
  await page.getByRole('heading', { name: rowText }).waitFor({ timeout: 10000 })
  const snooze = content.getByRole('button', { name: 'snooze', exact: true })
  const count = await snooze.count()
  assert(
    count === 1,
    `${view} detail pane offers the snooze affordance`,
    `${view} detail pane is missing the snooze affordance (count ${count})`
  )
  await snooze.click()
  await content.getByRole('button', { name: 'Tomorrow', exact: true }).waitFor({ timeout: 10000 })
  assert(true, `${view} snooze opens the preset choices`, `${view} preset choices did not open`)
  await page.screenshot({ path: resolve(art, `snooze-surface-${view.toLowerCase()}.png`) })
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
}

await openAndAssertSnooze('Promotions', 'Trail shoes flash sale')
await openAndAssertSnooze('Important', 'Budget approval needed by Friday')

// Parking is not offered where the mail is not the user's to keep.
await page.getByRole('button', { name: 'Spam', exact: true }).click()
const spam = page.getByRole('complementary', { name: 'Spam' })
await spam.waitFor({ timeout: 10000 })
if ((await spam.getByRole('listitem').count()) > 0) {
  await spam.getByRole('listitem').first().getByRole('button').first().click()
  await page.getByRole('region', { name: 'Email content' }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(200)
  const spamSnooze = await page
    .getByRole('region', { name: 'Email content' })
    .getByRole('button', { name: 'snooze', exact: true })
    .count()
  assert(spamSnooze === 0, 'Spam detail pane keeps snooze hidden', 'Spam detail pane offers snooze')
}

console.log(failures.length === 0 ? 'RESULT pass feature=snooze-surface' : 'RESULT fail feature=snooze-surface')
await browser.close()
process.exit(failures.length === 0 ? 0 : 1)
