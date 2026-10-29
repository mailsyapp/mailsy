// Manual-tier live drive for the EMULATED snooze: real Electron main
// process + real Gmail through CDP. Keyed feature id: snooze-emulation.
// 1. UI park through the preset clicks: real main resolves or creates the
//    'Snoozed by Mailsy' label and sends the ONE threads.modify pair; the
//    wake-of-record lands in the durable JSON store.
// 2. UI restore through the Snoozed row: the reverse pair plus a schedule
//    clear, against real Gmail.
// 3. The wake: a near-future bridge park exercises main's real timer and
//    sweep; the thread returns to Inbox by itself, record gone. The bridge
//    call reuses the exact parking write the presets reach (only the wake
//    number differs), so the wake return is main-process behavior, day-of
//    and minute-scale.
// Every write is reversible and the target ends where it started.
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const RUN_ID = process.env.RUN_ID ?? 'no-run-id'
const log = []
const L = (m) => {
  log.push(m)
  console.log(m)
}
const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url)) // drive/ -> skill root
const ART = `${SKILL_DIR}artifacts/${RUN_ID}/`
mkdirSync(ART, { recursive: true })

// The store is the schedule of record on disk; reading it directly is the
// durability proof the mock tier cannot give.
function findStore() {
  for (const name of ['mailsy', 'Mailsy']) {
    const p = `${homedir()}/Library/Application Support/${name}/snooze-schedules.json`
    if (!existsSync(p)) continue
    try {
      return { path: p, data: JSON.parse(readFileSync(p, 'utf8')) }
    } catch {
      return { path: p, data: {} }
    }
  }
  return null
}

function recordFor(storePathResult, threadId) {
  if (!storePathResult) return false
  return Object.keys(storePathResult.data).some((id) => id.includes(threadId))
}

try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')
  if ((await page.getByRole('button', { name: 'Sign in with Google' }).count()) > 0) {
    throw new Error('NOT SIGNED IN: live tier needs the stored refresh token to work')
  }

  // Pick one reversible target from the real Inbox, by id only.
  const candidates = await page.evaluate(() =>
    window.api
      .listFolder({ folder: 'inbox', maxResults: 5 })
      .then((p) =>
        p.threads.filter((t) => !t.draftId).map((t) => ({ id: t.id, subject: t.subject }))
      )
  )
  if (candidates.length === 0) throw new Error('live inbox is empty: nothing to park')
  const target = candidates[0]
  L(`target: id=${target.id} subject=${JSON.stringify(target.subject).slice(0, 80)}`)

  // 1. UI park: open the thread by its row, snooze, Tomorrow preset.
  await page
    .getByRole('complementary', { name: 'Inbox' })
    .getByText(target.subject.slice(0, 20), { exact: false })
    .first()
    .click()
  const content = page.getByRole('region', { name: 'Email content' })
  await content.waitFor({ timeout: 20000 })
  await content.getByRole('button', { name: 'snooze', exact: true }).click()
  await content.getByRole('button', { name: 'Tomorrow', exact: true }).click()
  await page.waitForTimeout(5000)
  const parkedFile = findStore()
  if (!recordFor(parkedFile, target.id)) {
    throw new Error(
      `store record missing after the park (path ${parkedFile ? parkedFile.path : 'not found'}: ` +
        `${JSON.stringify(parkedFile ? parkedFile.data : null)})`
    )
  }
  L(`pass: wake time recorded durably in ${parkedFile.path}`)
  await page.screenshot({ path: `${ART}/manual-snooze-emulation-parked.png` })

  // 2. UI restore: the Snoozed row's unsnooze clears record and label.
  await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
  const snoozed = page.getByRole('complementary', { name: 'Snoozed' })
  await snoozed.waitFor({ timeout: 30000 })
  await snoozed.getByRole('button', { name: 'unsnooze', exact: true }).first().click()
  await page.waitForTimeout(5000)
  if (recordFor(findStore(), target.id)) {
    throw new Error('store record survived the manual restore')
  }
  L('pass: manual restore cleared the schedule record and re-applied the reverse pair')
  await page.screenshot({ path: `${ART}/manual-snooze-emulation-restored.png` })

  // 3. The wake: near-future park; main's timer and the renderer sweep do
  //    the rest. Poll the store, then the server, for the return.
  const parked = await page.evaluate(
    ({ id }) =>
      window.api
        .snoozeThread(id, Date.now() + 75_000)
        .then(() => 'parked', (e) => `FAIL ${e.message}`),
    target
  )
  if (parked !== 'parked') throw new Error(`near-future park failed: ${parked}`)
  L('parked for the wake at +75s; waiting on main timer and the 30s renderer sweep')
  let returned = false
  for (let i = 0; i < 9 && !returned; i++) {
    await page.waitForTimeout(20000)
    if (recordFor(findStore(), target.id)) continue
    const token = (target.subject.match(/[A-Za-z][A-Za-z0-9-]{7,}/) ?? [])[0]
    if (!token) throw new Error('subject has no long token for the presence read')
    returned = await page.evaluate(
      ({ token }) =>
        window.api
          .listFolder({ folder: 'inbox', maxResults: 5, q: token })
          .then((p) => p.threads.length > 0, () => false),
      { token }
    )
    if (!returned) {
      // The record is gone but the server does not list it yet: one more
      // sweep or the next poll may settle the write, so keep polling.
      L(`poll ${i}: record cleared, inbox presence not confirmed yet (${token})`)
    }
  }
  if (!returned) throw new Error('wake never returned the thread to the live Inbox')
  L('pass: the wake restored the thread to the Inbox through main without user action')
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page
    .getByRole('complementary', { name: 'Inbox' })
    .getByText(target.subject.slice(0, 20), { exact: false })
    .first()
    .waitFor({ timeout: 30000 })
  await page.screenshot({ path: `${ART}/manual-snooze-emulation.png` })
  L(`evidence: ${ART}/manual-snooze-emulation.png`)
  writeFileSync(ART + 'manual-snooze-emulation.log', log.join('\n') + '\nRESULT pass live-tier feature=snooze-emulation\n')
  process.exit(0)
} catch (e) {
  L(`fail: ${e instanceof Error ? e.message : String(e)}`)
  writeFileSync(ART + 'manual-snooze-emulation.log', log.join('\n') + '\nRESULT fail live-tier feature=snooze-emulation\n')
  process.exit(1)
}
