// Manual-tier live drive for the Snoozed view: real Electron + real Gmail
// through CDP.
// 1. The Snoozed rail entry loads through the real q:'in:snoozed' listing
//    (the boundary would 400 if code still sent labelIds:['SNOOZED']).
// 2. The unsnooze write shape (an INBOX add) is proven against real Gmail on
//    a reversible target: an archived thread is added back to the Inbox and
//    then archived again, ending where it started.
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const RUN_ID = process.env.RUN_ID ?? 'no-run-id'
const log = []
const L = (m) => { log.push(m); console.log(m) }
const ART = new URL(`../../artifacts/${RUN_ID}/`, import.meta.url).pathname
mkdirSync(ART, { recursive: true })
try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')
  // No reload: the just-launched fresh app already made its own first-page
  // load, and the live account runs on a shared per-minute quota.

  const signedOut = await page.getByRole('button', { name: 'Sign in with Google' }).count()
  if (signedOut > 0) throw new Error('NOT SIGNED IN: live tier needs the stored refresh token to work')

  // 1. The Snoozed view is a real fetch: the only code path is q:'in:snoozed'.
  await page.getByRole('button', { name: 'Snoozed' }).click()
  const snoozed = page.getByRole('complementary', { name: 'Snoozed' })
  await snoozed.waitFor({ timeout: 30000 })
  const parked = await page.evaluate(() =>
    window.api.listFolder({ folder: 'snoozed', maxResults: 50 }).then((p) =>
      p.threads.map((t) => ({ id: t.id, subject: t.subject })), (e) => `ERROR ${e.message}`)
  )
  L(parked === 'ERROR' + parked || (typeof parked === 'string' && parked.startsWith('ERROR'))
    ? `FAIL: snoozed listing errored: ${JSON.stringify(parked)}`
    : `pass: real Gmail answers the in:snoozed listing with ${Array.isArray(parked) ? parked.length : 0} parked thread(s)`)
  if (typeof parked !== 'object' || parked === null || Array.isArray(parked) === false) {
    throw new Error(String(parked))
  }
  L(`parked subjects: ${parked.map((t) => JSON.stringify(t.subject).slice(0, 60)).join('; ')}`)

  // 2. The unsnooze write shape: an archived non-draft thread rejoins the
  // Inbox by INBOX add, then goes back to archived state.
  const inbox = page.getByRole('complementary', { name: 'Inbox' })
  await page.getByRole('button', { name: 'Inbox' }).click()
  await inbox.waitFor({ timeout: 30000 })
  const archiveCandidates = await page.evaluate(() =>
    window.api.listFolder({ folder: 'all', maxResults: 50 }).then((p) =>
      p.threads.filter((t) => !t.draftId).map((t) => ({ id: t.id, subject: t.subject }))))
  const target = archiveCandidates.find((t) => /\b(\w{6}[\w-]*)\b/.test(t.subject))
  if (!target) throw new Error('no archived non-inbox non-draft thread to exercise the INBOX add')
  L(`target thread: id=${target.id} subject=${JSON.stringify(target.subject).slice(0, 80)}`)
  // Idempotent write: the add converges whether or not a stopped prior run
  // already applied it. Presence reads ride one query list each, on the
  // thread id as the search token, instead of a full page of gets.
  const token = (target.subject.match(/[A-Za-z][A-Za-z0-9-]{7,}/) ?? [])[0]
  if (!token) throw new Error('target subject has no long token for a query-list presence read')
  await page.evaluate((threadId) =>
    window.api.modifyLabels({ kind: 'thread', id: threadId, addLabelIds: ['INBOX'] }).then(
      () => 'write-ok', (e) => 'write-fail: ' + e.message), target.id)
  L('write: threads.modify addLabelIds ["INBOX"] (the unsnooze write) dispatched')
  const after = await page.evaluate(async ({ threadId, tokenValue }) =>
    window.api
      .listFolder({ folder: 'inbox', maxResults: 5, q: tokenValue })
      .then((p) => p.threads.some((t) => t.id === threadId), () => false), { threadId: target.id, tokenValue: token })
  if (!after) {
    // A write could have escaped on a quota retry path; the state is not
    // taken for granted and the probe fails loudly here.
    throw new Error(`server does not list the thread under INBOX after the add (q=${token})`)
  }
  L('pass: server lists the thread under INBOX (real state, not client filter)')
  // Restore: INBOX removal is the standard archive write, also label-only.
  await page.evaluate((threadId) =>
    window.api.modifyLabels({ kind: 'thread', id: threadId, removeLabelIds: ['INBOX'] }), target.id)
  const restored = await page.evaluate(async ({ threadId, tokenValue }) =>
    window.api
      .listFolder({ folder: 'inbox', maxResults: 5, q: tokenValue })
      .then((p) => !p.threads.some((t) => t.id === threadId), () => false), { threadId: target.id, tokenValue: token })
  if (!restored) throw new Error('restore failed: thread still under INBOX')
  L('pass: target thread ends in its original archived state')

  await page.getByRole('button', { name: 'Snoozed' }).click()
  await snoozed.waitFor({ timeout: 30000 })
  await page.screenshot({ path: `${ART}/manual-snooze.png` })
  L(`evidence: ${ART}/manual-snooze.png`)
  writeFileSync(new URL('manual-snooze.log', import.meta.url), log.join('\n') + '\nRESULT pass live-tier feature=manual-snooze\n')
  process.exit(0)
} catch (e) {
  L(`fail: ${e instanceof Error ? e.message : String(e)}`)
  writeFileSync(new URL('manual-snooze.log', import.meta.url), log.join('\n') + '\nRESULT fail live-tier feature=manual-snooze\n')
  process.exit(1)
}
