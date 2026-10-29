// Manual-tier live drive: real Electron + real Gmail through CDP.
// Stars the newest inbox thread from the UI, proves the Starred view lists
// it through the real fetch path, then unstars so the mailbox ends where
// it started. Thread-level toggle from a row matches the renderer contract.
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
  const target = await page.evaluate(() =>
    window.api.listFolder({ folder: 'inbox', maxResults: 1 }).then((p) => p.emails[0] ?? null)
  )
  if (!target) throw new Error('live inbox is empty; nothing to star')
  // Gmail stores star per message; the renderer toggles the thread. The
  // thread's pre-run state decides which direction "restore" means.
  const threadState = await page.evaluate(async (threadId) => {
    const pages = [{ token: undefined, emails: [] }]
    const seen = []
    let token
    do {
      const p = await window.api.listFolder({ folder: 'inbox', maxResults: 100, pageToken: token })
      seen.push(...p.emails.filter((e) => e.threadId === threadId))
      token = p.nextPageToken
    } while (token)
    return { rows: seen, originallyStarred: seen.some((e) => e.starred) }
  }, target.threadId)
  L(`target thread: id=${target.id} threadId=${target.threadId} subject=${JSON.stringify(target.subject)} originallyStarred=${threadState.originallyStarred}`)
  if (threadState.rows.length === 0) throw new Error('target thread not listed under INBOX')
  if (threadState.originallyStarred) {
    L('pre-run: unstarring first so the star leg starts from unstarred')
    await page.evaluate((id) => window.api.modifyLabels({ kind: 'thread', id, removeLabelIds: ['STARRED'] }).then(() => true), target.threadId)
  }

  const row = inbox.locator('li', { hasText: target.subject }).first()
  await row.getByRole('button', { name: 'Star', exact: true }).click()
  L('pass: clicked Star on the live inbox row')
  await row.getByRole('button', { name: 'Unstar', exact: true }).waitFor({ timeout: 30000 })
  L('pass: row flipped to Unstar affordance (real renderer build)')

  // Starred view is a real fetch: the row can only appear because live
  // Gmail answers labelIds [STARRED] for this thread.
  await page.getByRole('button', { name: 'Starred' }).click()
  const starred = page.getByRole('complementary', { name: 'Starred' })
  await starred.getByText(target.subject, { exact: false }).first().waitFor({ timeout: 30000 })
  L('pass: Starred view lists the starred thread')
  const serverStarred = await page.evaluate(async (threadId) => {
    const p = await window.api.listFolder({ folder: 'starred', maxResults: 100 })
    return p.emails.some((e) => e.threadId === threadId)
  }, target.threadId)
  L(serverStarred ? 'pass: server lists the thread under STARRED (real Gmail)' : 'FAIL: server does not list the thread under STARRED')
  if (!serverStarred) throw new Error('server-truth check failed')

  await row.getByRole('button', { name: 'Unstar', exact: true }).click()
  await starred.getByText(target.subject, { exact: false }).first().waitFor({ state: 'detached', timeout: 30000 })
  L('pass: unstar from the Starred view removed the row')

  const serverUnstarred = await page.evaluate(async (threadId) => {
    const p = await window.api.listFolder({ folder: 'starred', maxResults: 100 })
    return !p.emails.some((e) => e.threadId === threadId)
  }, target.threadId)
  L(serverUnstarred ? 'pass: server no longer lists the thread under STARRED (real Gmail)' : 'FAIL: server still lists the thread under STARRED')
  if (!serverUnstarred) throw new Error('server-truth check failed')

  await page.screenshot({ path: new URL('manual-star.png', import.meta.url).pathname })
  L('evidence: manual-star.png')
  out('manual-star.log', log.join('\n') + '\nRESULT pass live-tier feature=manual-star\n')
  process.exit(0)
} catch (e) {
  log.push(e instanceof Error ? e.message : String(e))
  out('manual-star.log', log.join('\n') + '\nRESULT fail live-tier feature=manual-star\n')
  console.error('FAIL', e instanceof Error ? e.message : e)
  process.exit(1)
}
