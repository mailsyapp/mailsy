// Manual-tier live drive: real Electron + real Gmail through CDP.
// Archives the newest inbox thread via the UI, then restores its INBOX label
// through the same production bridge so the mailbox ends where it started.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const log = []
const L = (m) => { log.push(m); console.log(m) }
const out = (f, s) => writeFileSync(new URL(f, import.meta.url), s)
try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')
  await page.reload({ waitUntil: 'domcontentloaded' })

  const signedOut = await page.getByRole('button', { name: 'Sign in with Google' }).count()
  if (signedOut > 0) throw new Error('NOT SIGNED IN: live tier needs the stored refresh token to work')

  const inbox = page.getByRole('complementary', { name: 'Inbox' })
  await inbox.waitFor({ timeout: 30000 })
  const firstRow = await page.evaluate(() =>
    window.api.listFolder({ folder: 'inbox', maxResults: 1 }).then((p) => p.emails[0] ?? null)
  )
  if (!firstRow) throw new Error('live inbox is empty; nothing to archive')
  L(`target thread: id=${firstRow.id} threadId=${firstRow.threadId} subject=${JSON.stringify(firstRow.subject)}`)

  const countBefore = await inbox.getByText(firstRow.subject, { exact: false }).count()
  await inbox.getByText(firstRow.subject, { exact: false }).first().click()
  await page.getByRole('region', { name: 'Email content' }).getByRole('button', { name: 'archive' }).waitFor({ timeout: 30000 })
  L('pass: archive button exists on the open inbox message (real renderer build)')
  await page.getByRole('region', { name: 'Email content' }).getByRole('button', { name: 'archive' }).click()
  L('pass: clicked archive in the live UI')

  await inbox.getByText(firstRow.subject, { exact: false }).first().waitFor({ state: 'detached', timeout: 30000 })
  L(`pass: thread rows left the live inbox list (before count ${countBefore})`)

  // Server-truth check through the real fetch path: a full folder reload must
  // not re-list the thread.
  const stillGone = await page.evaluate(async (id) => {
    const p = await window.api.listFolder({ folder: 'inbox', maxResults: 50 })
    return !p.emails.some((e) => e.threadId === id)
  }, firstRow.threadId)
  L(stillGone ? 'pass: server no longer lists the thread under INBOX (real Gmail)' : 'FAIL: thread still listed in live inbox')
  if (!stillGone) throw new Error('server-truth check failed')

  await page.screenshot({ path: new URL('manual-archive.png', import.meta.url).pathname })
  L('evidence: manual-archive.png')

  const restored = await page.evaluate((id) =>
    window.api.modifyLabels({ kind: 'thread', id, addLabelIds: ['INBOX'] }).then(() => true), firstRow.threadId)
  L(restored ? 'restore: INBOX re-applied through the same production bridge' : 'restore failed')
  const back = await page.evaluate(async (id) => {
    const p = await window.api.listFolder({ folder: 'inbox', maxResults: 50 })
    return p.emails.some((e) => e.threadId === id)
  }, firstRow.threadId)
  L(back ? 'pass: mailbox restored; thread listed under INBOX again' : 'FAIL: mailbox not restored')
  if (!back) throw new Error('restore did not take')
  out('manual-archive.log', log.join('\n') + '\nRESULT pass live-tier feature=manual-archive\n')
  process.exit(0)
} catch (e) {
  log.push(e instanceof Error ? e.message : String(e))
  out('manual-archive.log', log.join('\n') + '\nRESULT fail live-tier feature=manual-archive\n')
  console.error('FAIL', e instanceof Error ? e.message : e)
  process.exit(1)
}
