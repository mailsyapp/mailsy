#!/usr/bin/env node
// Driver for verify-mailsy. Drives the real renderer through the UI only.
// Usage: node scripts/drive.mjs --feature <id> --run-id <id> --port <n> [--signed-out]
// Exit: 0 pass, 1 journey failure (reason in log), 2 infra failure.
// Playwright resolves from the skill's single dependency install (../drive,
// see SKILL.md Helpers) instead of a local node_modules.
import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launchPackaged } from './packaged.mjs'

const require2 = createRequire(new URL('../drive/', import.meta.url))
const { chromium } = require2('playwright')

const here = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(here, '..')
const MOCK = resolve(SKILL_DIR, 'fixtures/api-mock.js')

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? def : (process.argv[i + 1] ?? def)
}
const FEATURE = arg('feature')
const RUN_ID = arg('run-id')
const PORT = arg('port')
const SIGNED_OUT = process.argv.includes('--signed-out')
const EXECUTABLE = arg('executable')
if (!FEATURE || !RUN_ID || (!PORT && !EXECUTABLE)) {
  console.error('usage: drive.mjs --feature <id> --run-id <id> (--port <n> | --executable <packaged-binary>) [--signed-out]')
  process.exit(2)
}
// RUN_ID names the artifacts dir under the skill; refuse any value that
// could escape it (matches the serve.sh/doctor.sh guard).
if (!/^[A-Za-z0-9._-]+$/.test(RUN_ID)) {
  console.error(`infra: --run-id may contain only letters, digits, '.', '_' and '-' (got '${RUN_ID}')`)
  process.exit(2)
}
try {
  await access(MOCK, constants.R_OK)
} catch {
  console.error(`infra: mock missing at ${MOCK}`)
  process.exit(2)
}

const ART = resolve(SKILL_DIR, 'artifacts', RUN_ID)
mkdirSync(ART, { recursive: true })
let entry = EXECUTABLE ? resolve(EXECUTABLE) : `http://127.0.0.1:${PORT}/`
const logLines = [`command: drive.mjs --feature ${FEATURE} --run-id ${RUN_ID} ${EXECUTABLE ? `--executable ${entry}` : `--port ${PORT}`}${SIGNED_OUT ? ' --signed-out' : ''}`, `entry: ${entry}`]
const log = (m) => { logLines.push(m); console.log(m) }
function assert(cond, okMsg, failMsg) {
  if (!cond) throw new Error(`ASSERT: ${failMsg}`)
  log(`pass: ${okMsg}`)
}

// Checkbox state flips asynchronously after the boundary write resolves
// (the menu re-derives from the thread's own label list), so a click is
// followed by this bounded wait instead of an instant read.
async function waitForChecked(box, expected, okMsg, failMsg, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await box.isChecked()) === expected) {
      assert(true, okMsg, failMsg)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(false, okMsg, failMsg)
}

// aria-pressed flips in a post-mount effect (the signature auto-insert
// and the mount-time presence derivation run after the DOM commit), so a
// read taken as soon as the heading appears can beat them. Polls like the
// checkbox waits do instead of trusting the first snapshot.
async function waitForPressed(button, expected, okMsg, failMsg, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await button.getAttribute('aria-pressed')) === expected) {
      assert(true, okMsg, failMsg)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(false, okMsg, failMsg)
}

// The compose body is an uncontrolled contenteditable (.body-editor) since
// the inline-images change: typing a prefix into a prefilled quote — or a
// line after an inline image — needs the caret placed first, because
// Playwright's fill replaces the whole rich content.
async function typeAtStart(editor, text) {
  await editor.evaluate((el) => {
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(true)
    sel.addRange(range)
  })
  await editor.pressSequentially(text)
}

async function typeAtEnd(editor, text) {
  await editor.evaluate((el) => {
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.addRange(range)
  })
  await editor.pressSequentially(text)
}

// The rich body's text as the composers see it: the editor's innerText,
// not an input value — a contenteditable has none.
async function bodyTextOf(editor) {
  return (await editor.evaluate((el) => el.innerText)) ?? ''
}

async function snapshot(page, name) {
  const snap = await page.locator('body').ariaSnapshot()
  writeFileSync(resolve(ART, `${name}.aria.txt`), `feature: ${FEATURE}\nentry: ${entry}\n${snap}\n`)
  await page.screenshot({ path: resolve(ART, `${name}.png`) })
  log(`evidence: ${name}.aria.txt + ${name}.png`)
}

async function activateLoadMore(page, view) {
  await view.getByRole('button', { name: 'Load more', exact: true }).evaluate(
    (button) => button.focus({ preventScroll: true }), undefined, { timeout: 5000 }
  )
  await page.keyboard.press('Enter')
}

async function holdContinuations(page) {
  await page.evaluate(() => {
    const listFolder = (window.__packagedFixtureApi ?? window.api).listFolder
    window.__heldContinuations = []
    ;(window.__packagedFixtureApi ?? window.api).listFolder = async (options) => {
      const result = await listFolder(options)
      if (options.pageToken) {
        await new Promise((release) => window.__heldContinuations.push({
          release, subjects: result.threads.map(({ subject }) => subject)
        }))
      }
      return result
    }
  })
}

async function releaseContinuation(page, index) {
  await page.evaluate(async (at) => {
    window.__heldContinuations[at].release()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  }, index)
}

async function startOrObserveLoadMore(page, view, heldCount) {
  const trigger = view.getByRole('button', { name: 'Load more', exact: true }).or(
    view.getByRole('status').filter({ hasText: 'Loading more...' })
  )
  const focusedButton = await trigger.evaluate((el) => {
    if (el.tagName !== 'BUTTON') return false
    el.focus({ preventScroll: true })
    return true
  }, undefined, { timeout: 5000 })
  if (focusedButton) await page.keyboard.press('Enter')
  await page.waitForFunction((n) => window.__heldContinuations.length === n, heldCount, { timeout: 5000 })
}

async function switchDuringPagination(page) {
  const inbox = page.getByRole('complementary', { name: 'Inbox', exact: true })
  const rail = page.getByRole('navigation', { name: 'Mail folders' })
  const labels = rail.getByRole('button', { name: 'Labels', exact: true })
  if (await labels.count()) await labels.click()
  await page.evaluate(async () => {
    const labels = await (window.__packagedFixtureApi ?? window.api).listLabels()
    const receipts = labels.find(({ name }) => name === 'Receipts')
    for (let i = 1; i <= 35; i++) {
      const { delta } = window.__deliverMail({ subject: `Label paging ${i}` })
      await (window.__packagedFixtureApi ?? window.api).modifyLabels({
        kind: 'thread', id: delta.threads[0].id, addLabelIds: [receipts.id]
      })
    }
  })
  await holdContinuations(page)

  for (const [index, name, lastSubject] of [[0, 'Drafts', 'Later draft 30'], [2, 'Receipts', 'Label paging 35']]) {
    await rail.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.getByRole('listitem').nth(29).waitFor({ timeout: 5000 })
    await startOrObserveLoadMore(page, inbox, index + 1)

    await rail.getByRole('button', { name, exact: true }).click()
    const destination = page.getByRole('complementary', { name, exact: true })
    await destination.getByRole('listitem').nth(29).waitFor({ timeout: 5000 })
    await startOrObserveLoadMore(page, destination, index + 2).catch(() => {
      throw new Error(`ASSERT: the abandoned Inbox request blocked pagination in ${name}`)
    })
    log(`pass: ${name} can load its next page while Inbox is still in flight`)
    const oldSubjects = await page.evaluate((n) => window.__heldContinuations[n].subjects, index)
    assert(oldSubjects.length > 0, 'the held Inbox page contains rows', 'the held Inbox page was empty')
    await releaseContinuation(page, index)
    const busy = destination.getByRole('status').filter({ hasText: 'Loading more...' })
    const leakedRows = await Promise.all(oldSubjects.map(
      (subject) => destination.getByText(subject, { exact: true }).count()
    ))
    assert(
      (await busy.count()) === 1 && leakedRows.every((count) => count === 0),
      `the old Inbox response neither paints ${name} nor clears its busy state`,
      `the superseded request changed the active ${name} list or its loading state`
    )
    await releaseContinuation(page, index + 1)
    await destination.getByText(lastSubject, { exact: true }).waitFor({ timeout: 5000 })
    await snapshot(page, `pagination-switch-${name.toLowerCase()}`)
  }
}

async function holdAccountRequests(page, inbox) {
  await page.evaluate(() => {
    for (let i = 1; i <= 32; i++) window.__deliverMail({ subject: `Old account ${i}` })
    window.__pushSync({ kind: 'reset' })
    window.__heldRefreshes = []
    ;(window.__packagedFixtureApi ?? window.api).syncMail = () => new Promise((resolve) => window.__heldRefreshes.push(resolve))
  })
  await holdContinuations(page)
  await activateLoadMore(page, inbox)
  await page.waitForFunction(() => window.__heldContinuations.length === 1)
  await page.getByRole('button', { name: 'Refresh mail' }).click()
  await page.waitForFunction(() => window.__heldRefreshes.length === 1)
}

async function signInWithPendingMail(page) {
  await page.evaluate(() => {
    const subjects = Array.from({ length: 32 }, (_, i) => `New account ${i + 1}`)
    const rows = subjects.map((subject) => window.__deliverMail({ subject }).delta.threads[0])
    ;(window.__packagedFixtureApi ?? window.api).listFolder = async (options) => options.pageToken
      ? { threads: rows.slice(30), nextPageToken: null }
      : { threads: rows.slice(0, 30), nextPageToken: '30' }
  })
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  const inbox = page.getByRole('complementary', { name: 'Inbox', exact: true })
  await inbox.getByText('New account 1', { exact: true }).waitFor({ timeout: 5000 })
  await page.evaluate(async () => {
    window.__releaseOldDraftSave()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  assert(
    (await page.evaluate(() => window.__accountDraftWrites))?.join() === 'First edit in old account',
    'the old composer cannot save into the new account after a held write settles',
    'an old composer dispatched a draft save into the next account'
  )
  const refresh = page.getByRole('button', { name: 'Refresh mail' })
  const oldRefreshCleared = (await refresh.getAttribute('aria-busy')) === 'false'
  await refresh.click()
  const startedOwnRefresh = await page.evaluate(() => window.__heldRefreshes.length === 2)

  await page.evaluate(async () => {
    const { delta } = window.__deliverMail({ subject: 'Late refresh from prior account' })
    window.__heldRefreshes[0](delta)
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
  assert(
    (await inbox.getByText('Late refresh from prior account', { exact: true }).count()) === 0,
    'the late refresh never displays mail from the previous account',
    'a refresh started before sign-out displayed its old account mail after sign-in'
  )
  assert(
    oldRefreshCleared && startedOwnRefresh && (await refresh.getAttribute('aria-busy')) === 'true',
    'the second account owns its refresh button independently',
    'the old refresh blocked or cleared the second account refresh'
  )
  assert(
    (await inbox.getByRole('button', { name: 'Load more', exact: true }).count()) === 1,
    'the second account can page while the old list request is held',
    'the previous account still owns the pagination control'
  )
  await activateLoadMore(page, inbox)
  await inbox.getByText('New account 32', { exact: true }).waitFor({ timeout: 5000 })
  await releaseContinuation(page, 0)
  await page.evaluate(() => window.__heldRefreshes[1]({
    kind: 'delta', historyId: 'new-account', threads: [], deletedThreadIds: []
  }))
  assert(
    (await inbox.getByRole('listitem').count()) === 32 &&
      (await inbox.getByText(/^Old account /).count()) === 0,
    'the new mailbox keeps only its own results after both old requests settle',
    'late page results changed the new mailbox'
  )
  await snapshot(page, 'sign-in-pending-mail')

  const rail = page.getByRole('navigation', { name: 'Mail folders' })
  const labels = rail.getByRole('button', { name: 'Labels', exact: true })
  if (await labels.count()) await labels.click()
  await rail.getByRole('button', { name: 'Receipts', exact: true }).click()
  await page.getByRole('complementary', { name: 'Receipts', exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await inbox.getByText('New account 1', { exact: true }).waitFor({ timeout: 5000 })
  assert(true, 'signing back in after leaving a label opens Inbox', 'the previous account label was retained')
}

let browser
let exitCode = 0
try {
  let page
  if (EXECUTABLE) {
    const packaged = await launchPackaged({
      executablePath: resolve(EXECUTABLE), artifactDir: ART, mockPath: MOCK,
      signedOut: SIGNED_OUT, clock: FEATURE === 'snooze-emulation' || FEATURE === 'background-work' || FEATURE === 'delete-draft' || FEATURE === 'draft-attachments-safe' || FEATURE === 'snooze-wake'
    })
    browser = packaged.browser
    page = packaged.page
    entry = packaged.entry
    log(`packaged: ${JSON.stringify(packaged.identity)}`)
    log(`entry: ${entry}`)
  } else {
    browser = await chromium.launch()
    const context = await browser.newContext()
    await context.addInitScript({ path: MOCK })
    if (SIGNED_OUT) {
      await context.addInitScript(() => {
        ;(window.__packagedFixtureApi ?? window.api).isSignedIn = async () => false
        ;(window.__packagedFixtureApi ?? window.api).signIn = async () => { window.__signInClicked = true }
      })
    }
    page = await context.newPage()
    // Fast-forwarding journeys need fake timers installed before the app's
    // intervals exist; other features run on real time, unchanged.
    if (FEATURE === 'snooze-emulation' || FEATURE === 'background-work' || FEATURE === 'delete-draft' || FEATURE === 'draft-attachments-safe' || FEATURE === 'snooze-wake') await page.clock.install()
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  }

  const journeys = new Map()
  journeys.set('sign-in', async () => {
    const btn = page.getByRole('button', { name: 'Sign in with Google' })
    await btn.waitFor({ timeout: 10000 })
    assert(true, 'signed-out state offers "Sign in with Google"', 'sign-in button missing')
    await btn.click()
    assert(await page.evaluate(() => window.__signInClicked === true), 'click invokes sign-in bridge', 'sign-in bridge not invoked')
    await snapshot(page, 'sign-in')
    return 'sign-in'
  })
  journeys.set('sign-out', async () => {
    // Fresh page load, signed in by default (no --signed-out): the inbox
    // must be on screen so the flip has mail state to clear.
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await signOut.waitFor({ timeout: 10000 })
    assert(true, 'signed-in state offers the "Sign out" button', 'Sign out button missing while signed in')
    await holdAccountRequests(page, page.getByRole('complementary', { name: 'Inbox' }))
    await page.evaluate(() => {
      const api = window.__packagedFixtureApi ?? window.api
      const saveDraft = api.saveDraft
      window.__accountDraftWrites = []
      api.saveDraft = (request) => {
        window.__accountDraftWrites.push(request.subject)
        if (request.subject !== 'First edit in old account') return saveDraft(request)
        return new Promise((resolve) => {
          window.__releaseOldDraftSave = () => resolve({
            draftId: 'old-account-draft', messageId: 'old-account-message'
          })
        })
      }
    })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    const draftSubject = page.getByRole('region', { name: 'Email content' }).getByRole('textbox', { name: 'Subject' })
    await draftSubject.fill('First edit in old account')
    await page.waitForFunction(() => typeof window.__releaseOldDraftSave === 'function')
    await draftSubject.fill('Private pending edit in old account')
    // Closing while still signed in queues the edit behind the held save.
    await page.getByRole('complementary', { name: 'Inbox' }).getByText(/^Old account \d+$/).first().click()
    await draftSubject.waitFor({ state: 'detached' })
    await signOut.click()
    // Signed-out screen: the sign-in button returns and no mail rows stay
    // on the list. Both reads are the flip proof.
    await page.getByRole('button', { name: 'Sign in with Google' }).waitFor({ timeout: 10000 })
    const inboxRows = await page.getByRole('complementary', { name: 'Inbox' }).locator('li').count()
    assert(
      inboxRows === 0,
      'signing out flips to the "Sign in with Google" screen with no mail rows',
      'signed-out screen wrong or mail rows survived sign-out'
    )
    // Second assertion reads back the mock's recorded bridge call.
    assert(
      await page.evaluate(() => window.__signOutClicked === true),
      'click invokes the sign-out bridge',
      'sign-out bridge not invoked'
    )
    await snapshot(page, 'sign-out')
    await signInWithPendingMail(page)
    return 'sign-out'
  })
  journeys.set('inbox', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    for (const subject of ['Launch checklist', 'Q3 budget draft', 'Deploy window']) {
      await inbox.getByText(subject, { exact: false }).first().waitFor({ timeout: 10000 })
    }
    assert(true, 'inbox lists all 3 seeded subjects', 'seeded subjects missing from inbox')
    // Two seed messages share the Deploy window thread; the list must group
    // them into one row instead of rendering one row per message.
    const deployRows = await inbox.getByText('Deploy window', { exact: true }).count()
    assert(deployRows === 1, 'two-message thread renders one row', 'thread split into per-message rows')
    const deployRow = inbox.locator('li', { hasText: 'Deploy window' }).first()
    const names = await deployRow.textContent()
    assert(
      names.includes('Alan Turing') && names.includes('me@example.com'),
      `thread row summarizes both senders (${names?.slice(0, 120)})`,
      'participant summary missing senders'
    )
    await inbox.getByText('Launch checklist').first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    assert(true, 'selecting email opens its detail', 'detail did not open')
    await snapshot(page, 'inbox')
    return 'inbox'
  })
  journeys.set('search', async () => {
    const box = page.getByRole('searchbox', { name: 'Search emails' })
    await box.waitFor({ timeout: 10000 })
    await box.fill('budget')
    // Debounced commit (800ms) + async fetch: the match may already be
    // visible from the unfiltered list, so wait for the non-match to leave —
    // that only happens after the server commit replaces the list.
    // exact: true — the row subject itself, not the snippet text that
    // substring-matches the same words. Otherwise two elements match and
    // strict-mode waitFor trips on the locator, not the app.
    await page.getByText('Launch checklist', { exact: true }).waitFor({ state: 'detached', timeout: 10000 })
    await page.getByText('Q3 budget draft').first().waitFor({ timeout: 10000 })
    await page.getByText(/results? for “budget”/).waitFor({ timeout: 5000 })
    assert(true, 'search "budget" surfaces the budget draft and filters the rest', 'filtering did not happen')
    await page.getByText('End of results', { exact: true }).waitFor({ timeout: 10000 })
    await box.fill('from:nobody@example.invalid')
    await box.press('Enter')
    await page.getByRole('status').filter({ hasText: 'No results for' }).waitFor({ timeout: 10000 })
    assert(
      (await page.getByText('End of results', { exact: true }).count()) === 0 &&
        (await page.locator('.emails > li').count()) === 0,
      'a zero-result search has no End of results footer or mail rows',
      'a zero-result search retained the results footer or mail rows'
    )
    await snapshot(page, 'search-empty')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await page.getByText('Launch checklist').first().waitFor({ timeout: 10000 })
    assert(true, 'clear restores the full inbox', 'inbox not restored after clear')
    await snapshot(page, 'search')

    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      const parked = new Map()
      for (let i = 1; i <= 34; i++) {
        window.__deliverMail({ subject: `Paged search ${i}` })
        if (i === 14 || i === 16) {
          const { delta } = window.__deliverMail({ subject: `Paged search restored ${i}` })
          parked.set(i, delta)
          await api.modifyLabels({ kind: 'thread', id: delta.threads[0].id, removeLabelIds: ['INBOX'] })
        }
      }
      window.__restoreSearchMatch = async (i) => {
        const delta = parked.get(i)
        await api.modifyLabels({ kind: 'thread', id: delta.threads[0].id, addLabelIds: ['INBOX'] })
        window.__pushSync(i === 14 ? delta : { kind: 'reset' })
      }
    })
    await box.fill('Paged search')
    await box.press('Enter')
    await inbox.getByText('10 results for “Paged search”', { exact: true }).waitFor({ timeout: 5000 })
    await activateLoadMore(page, inbox)
    await inbox.getByText('20 results for “Paged search”', { exact: true }).waitFor({ timeout: 5000 })
    for (const i of [14, 16]) {
      const restored = inbox.getByText(`Paged search restored ${i}`, { exact: true })
      assert((await restored.count()) === 0, 'the parked match is not in search yet', 'parked match appeared early')
      await page.evaluate((id) => window.__restoreSearchMatch(id), i)
      await restored.waitFor({ timeout: 5000 })
    }
    for (const count of [20, 30]) {
      await inbox.getByText(`${count} results for “Paged search”`, { exact: true }).waitFor({ timeout: 5000 })
      await activateLoadMore(page, inbox)
    }
    await inbox.getByText('End of results', { exact: true }).waitFor({ timeout: 5000 })
    const subjects = [
      ...Array.from({ length: 34 }, (_, i) => `Paged search ${i + 1}`),
      'Paged search restored 14',
      'Paged search restored 16'
    ]
    const counts = await Promise.all(subjects.map((subject) => inbox.getByText(subject, { exact: true }).count()))
    assert(
      counts.every((count) => count === 1) && (await inbox.getByRole('listitem').count()) === subjects.length,
      'search reaches all 36 matches exactly once across four pages after a delta and reset',
      'search over 30 results skipped, duplicated, or mixed in other rows'
    )
    await snapshot(page, 'search-pagination')

    await inbox.getByRole('button', { name: 'Clear search' }).click()
    const unreadResult = inbox.getByRole('listitem').filter({ hasText: 'Launch checklist' })
    await unreadResult.getByRole('button', { name: 'mark unread', exact: true }).click()
    await unreadResult.getByRole('button', { name: 'mark read', exact: true }).waitFor({ timeout: 5000 })
    const matchingQuery = 'in:inbox Launch checklist'
    await box.fill(matchingQuery)
    await box.press('Enter')
    const matchingCount = inbox.getByText('1 result for “in:inbox Launch checklist”', { exact: true })
    await matchingCount.waitFor({ timeout: 5000 })
    await box.fill('is:unread Launch checklist')
    await box.press('Enter')
    await inbox.getByText(/results? for “is:unread Launch checklist”/).waitFor({ timeout: 5000 })
    await unreadResult.getByText('Launch checklist', { exact: true }).click()
    await page.waitForFunction(() => window.__mods.some(
      (mod) => mod.id === 'thread-launch' && mod.removeLabelIds?.includes('UNREAD')
    ))
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('button', { name: 'reply', exact: true }).click()
    const body = content.locator('.body-editor')
    await typeAtStart(body, 'Keep this unsent reply.\n\n')
    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      const { threads } = await api.listFolder({ folder: 'inbox', q: 'Launch checklist' })
      window.__pushSync({
        kind: 'delta', historyId: 'mark-read',
        threads: [{ ...threads.find(({ id }) => id === 'thread-launch'), labelIds: ['INBOX'] }],
        deletedThreadIds: []
      })
    })
    await unreadResult.waitFor({ state: 'detached', timeout: 5000 })
    assert(
      (await body.count()) === 1 && (await bodyTextOf(body)).includes('Keep this unsent reply.'),
      'the search drops an auto-read result without losing its open reply',
      'background search refresh discarded the unsent reply'
    )
    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      await api.modifyLabels({ kind: 'thread', id: 'thread-launch', addLabelIds: ['STARRED'] })
      const { threads } = await api.listFolder({ folder: 'inbox', q: 'Launch checklist' })
      window.__pushSync({
        kind: 'delta', historyId: 'mark-starred',
        threads: [{ ...threads.find(({ id }) => id === 'thread-launch'), labelIds: ['INBOX', 'STARRED'] }],
        deletedThreadIds: []
      })
    })
    await content.getByRole('button', { name: 'starred', exact: true }).waitFor({ timeout: 5000 })
    assert((await bodyTextOf(body)).includes('Keep this unsent reply.'), 'the open reply reflects Gmail star changes', 'the star update lost the reply')
    await snapshot(page, 'search-open-reply')

    await page.evaluate(() => {
      const api = window.__packagedFixtureApi ?? window.api
      const list = api.listFolder
      window.__searchFetches = []
      api.listFolder = (options) => {
        window.__searchFetches.push(options.q)
        return list(options)
      }
    })
    await box.fill(matchingQuery)
    await box.press('Enter')
    await matchingCount.waitFor({ timeout: 5000 })
    await unreadResult.getByText('Launch checklist', { exact: true }).waitFor({ timeout: 5000 })
    assert(
      !(await page.evaluate((q) => window.__searchFetches.includes(q), matchingQuery)),
      'the prior Launch checklist query comes from the search cache',
      'the missed cache would not exercise a matching cached transition'
    )
    assert(
      (await body.count()) === 1 && (await bodyTextOf(body)).includes('Keep this unsent reply.'),
      'a cached query that includes the thread preserves its open reply',
      'the matching cached query unmounted the reply before restoring the conversation'
    )

    await box.fill('budget')
    await box.press('Enter')
    await inbox.getByText(/results? for “budget”/).waitFor({ timeout: 5000 })
    await inbox.getByText('Q3 budget draft', { exact: true }).first().waitFor({ timeout: 5000 })
    assert(
      !(await page.evaluate(() => window.__searchFetches.includes('budget'))),
      'the prior budget query comes from the search cache',
      'the missed cache would not exercise selection ownership'
    )
    assert(
      (await content.getByText('Nothing open yet :P').count()) === 1 && (await body.count()) === 0,
      'reopening a cached search does not carry a conversation over from another search',
      'the old conversation stayed open when switching to an unrelated cached query'
    )
    return 'search'
  })
  journeys.set('search-state', async () => {
    const cases = [
      'cached-star',
      'cached-read',
      'cached-outside',
      'starred-query',
      'starred-restar',
      'starred-empty-add',
      'selected-starred-query',
      'selected-starred-folder',
      'unread-query',
      'complex-query',
      'failed-write'
    ]
    for (const scenario of cases.filter(
      (value) => !arg('search-case') || value === arg('search-case')
    )) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      const inbox = page.getByRole('complementary', { name: 'Inbox' })
      await inbox.getByText('Launch checklist', { exact: true }).waitFor()
      const content = page.getByRole('region', { name: 'Email content' })
      await page.evaluate(() => {
        window.__searchCalls = []
        const listFolder = (window.__packagedFixtureApi ?? window.api).listFolder
        ;(window.__packagedFixtureApi ?? window.api).listFolder = async (options) => {
          if (options?.q) window.__searchCalls.push(options.q)
          return listFolder(options)
        }
      })
      const box = page.getByRole('searchbox', { name: 'Search emails' })
      const row = inbox.locator('li', { hasText: 'Q3 budget draft' }).first()
      if (scenario === 'selected-starred-folder') {
        await row.getByRole('button', { name: 'Star', exact: true }).click()
        await row.getByRole('button', { name: 'Unstar', exact: true }).waitFor()
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Starred', exact: true })
          .click()
        const starredRow = page
          .getByRole('complementary', { name: 'Starred' })
          .locator('li', { hasText: 'Q3 budget draft' })
          .first()
        await starredRow.getByText('Q3 budget draft', { exact: true }).click()
        await content.getByRole('heading', { name: 'Q3 budget draft', exact: true }).waitFor()
        await content.getByRole('button', { name: 'starred', exact: true }).click()
        await starredRow.waitFor({ state: 'detached' })
        await content.getByText('Nothing open yet :P', { exact: true }).waitFor()
        assert(
          true,
          'unstar of the selected Starred-folder row closes its conversation',
          'selected Starred-folder conversation stayed open'
        )
        await snapshot(page, 'search-state-selected-starred-folder')
        continue
      }
      const cached = scenario.startsWith('cached-')
      const starredQuery = [
        'starred-query',
        'starred-restar',
        'starred-empty-add',
        'selected-starred-query'
      ].includes(scenario)
      const emptyAdd = scenario === 'starred-empty-add'
      const selectedStarred = scenario === 'selected-starred-query'
      const restar = scenario === 'starred-restar' || selectedStarred
      const unread = scenario === 'unread-query'
      const query = unread
        ? 'is:unread'
        : starredQuery
          ? 'is:starred'
          : scenario === 'complex-query'
            ? 'is:starred budget'
            : 'budget'
      if ((starredQuery && !emptyAdd) || unread || scenario === 'complex-query') {
        await row
          .getByRole('button', { name: unread ? 'mark unread' : 'Star', exact: true })
          .click()
        await row
          .getByRole('button', { name: unread ? 'mark read' : 'Unstar', exact: true })
          .waitFor()
      }
      await box.fill(query)
      await box.press('Enter')
      await inbox.getByText('Launch checklist', { exact: true }).waitFor({ state: 'detached' })
      if (!emptyAdd) await row.waitFor()
      else
        assert(
          (await row.count()) === 0,
          'plain starred search initially caches an empty result',
          'unstarred mail matched starred search'
        )
      if (scenario === 'cached-outside') {
        await box.press('Escape')
        await inbox.getByText('Launch checklist', { exact: true }).waitFor()
      }
      if (cached) {
        if (scenario !== 'cached-read') {
          await row.getByRole('button', { name: 'Star', exact: true }).click()
          await row.getByRole('button', { name: 'Unstar', exact: true }).waitFor()
        }
        if (scenario !== 'cached-star') {
          await row.getByRole('button', { name: 'mark unread', exact: true }).click()
          await row.getByRole('button', { name: 'mark read', exact: true }).waitFor()
        }
      } else if (scenario === 'failed-write') {
        await page.evaluate(() => {
          ;(window.__packagedFixtureApi ?? window.api).modifyLabels = async () => {
            throw new Error('Fixture mutation rejected')
          }
        })
        await row.getByRole('button', { name: 'Star', exact: true }).click()
        await page.getByText(/Fixture mutation rejected/).waitFor()
        assert(
          (await row.getByRole('button', { name: 'Star', exact: true }).count()) === 1,
          'a rejected mutation leaves current flags unchanged',
          'a rejected mutation changed current flags'
        )
      } else if (unread) {
        await row.getByText('Q3 budget draft', { exact: true }).click()
        await row
          .getByRole('button', { name: 'mark unread', exact: true })
          .waitFor({ timeout: 2000 })
          .catch(() => {})
        assert(
          (await content.getByRole('heading', { name: 'Q3 budget draft', exact: true }).count()) ===
            1 &&
            (await row.getByRole('button', { name: 'mark unread', exact: true }).count()) === 1,
          'opening an unread result marks it read and keeps its conversation open',
          'opening an unread result closed its conversation or failed to mark it read'
        )
        await snapshot(page, 'search-state-unread-open')
      } else if (!emptyAdd) {
        if (selectedStarred) {
          await row.getByText('Q3 budget draft', { exact: true }).click()
          await content.getByRole('heading', { name: 'Q3 budget draft', exact: true }).waitFor()
          await content.getByRole('button', { name: 'starred', exact: true }).click()
        } else {
          await row.getByRole('button', { name: 'Unstar', exact: true }).click()
        }
        if (starredQuery) {
          await row.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
          assert(
            (await row.count()) === 0,
            'is:starred: the nonmatching row leaves active results',
            'is:starred: the nonmatching row remained in active results'
          )
          if (selectedStarred)
            await content.getByText('Nothing open yet :P', { exact: true }).waitFor()
          await snapshot(page, `search-state-${scenario}-empty`)
        } else {
          await row.getByRole('button', { name: 'Star', exact: true }).waitFor()
          assert(
            (await row.count()) === 1,
            'compound queries are not interpreted as a plain operator',
            'compound query was pruned locally'
          )
        }
      }
      if (scenario !== 'cached-outside') {
        await box.press('Escape')
        await inbox.getByText('Launch checklist', { exact: true }).waitFor()
      }
      if (restar || emptyAdd) {
        await row.getByRole('button', { name: 'Star', exact: true }).click()
        await row.getByRole('button', { name: 'Unstar', exact: true }).waitFor()
      }
      await box.fill(query)
      await box.press('Enter')
      await inbox.getByText('Launch checklist', { exact: true }).waitFor({ state: 'detached' })
      if (starredQuery && !restar && !emptyAdd) {
        assert(
          (await row.count()) === 0,
          'reopened starred search refetches without the unstarred row',
          'a nonmatching row reappeared'
        )
      } else {
        await row.waitFor({ timeout: 3000 }).catch(() => {})
        if (restar || emptyAdd) {
          assert(
            (await row.getByRole('button', { name: 'Unstar', exact: true }).count()) === 1,
            `${scenario}: reopening shows the newly starred row`,
            `${scenario}: cached search lost the newly starred row`
          )
          if (selectedStarred)
            assert(
              (await content.getByText('Nothing open yet :P', { exact: true }).count()) === 1,
              'the deliberately closed selection does not reopen on re-star',
              're-star resurrected a stale selection'
            )
        } else if (cached) {
          const correctStar =
            scenario === 'cached-read' ||
            (await row.getByRole('button', { name: 'Unstar', exact: true }).count()) === 1
          const correctRead =
            scenario === 'cached-star' ||
            (await row.getByRole('button', { name: 'mark read', exact: true }).count()) === 1
          assert(
            correctStar && correctRead,
            `${scenario}: cached search keeps current flags`,
            `${scenario}: cached search restored stale star/unread flags`
          )
        } else if (unread) {
          assert(
            (await row.getByRole('button', { name: 'mark unread', exact: true }).count()) === 1,
            'unread search keeps the updated read flag without pruning the conversation',
            'unread search lost the updated row'
          )
        } else {
          assert(
            (await row.getByRole('button', { name: 'Star', exact: true }).count()) === 1,
            `${scenario}: cached flags stay unstarred`,
            `${scenario}: cached flags changed unexpectedly`
          )
        }
      }
      assert(
        await page.evaluate(
          (expected) => window.__searchCalls.length === expected,
          starredQuery ? 2 : 1
        ),
        starredQuery
          ? 'plain starred membership changes invalidate the cached query'
          : `${scenario}: reopening reuses the cached page`,
        'search cache refetch policy was incorrect'
      )
      await snapshot(page, `search-state-${scenario}`)
    }
    return 'search-state'
  })
  journeys.set('read-thread', async () => {
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByText('Deploy window').first().click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByText('2 messages in conversation').waitFor({ timeout: 10000 })
    assert(true, 'conversation shows 2 messages', 'thread count missing')
    // Latest message expanded by default; expand the first to prove toggling.
    const first = content.getByText('Can we move the deploy window to Thursday?')
    await first.first().waitFor({ timeout: 10000 })
    assert(true, 'thread messages readable', 'thread body missing')
    await snapshot(page, 'read-thread')
    return 'read-thread'
  })
  journeys.set('compose-send', async () => {
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist').first().click()
    await page.getByRole('button', { name: 'reply', exact: true }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'reply', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    assert(true, 'reply opens composer', 'composer did not open')
    const toValue = await page.locator('.composerField input').first().inputValue()
    assert(toValue.includes('ada@example.com'), `reply To prefilled (${toValue})`, 'reply To not prefilled')
    // The quote text stays in the rich body's prefill; typing ahead of it
    // at the document start keeps the quote intact underneath.
    await typeAtStart(page.locator('.body-editor'), 'On it — reviewing today.\n\n')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('status').getByText('Message sent.').waitFor({ timeout: 10000 })
    assert(true, '"Message sent." status appears', 'send status missing')
    const sent = await page.evaluate(() => window.__sent)
    assert(sent.length === 1 && sent[0].to.includes('ada@example.com') && sent[0].subject.includes('Launch checklist'),
      `outbox recorded reply ${JSON.stringify(sent)}`, 'outbox missing the reply')
    // Pins the Gmail-native quote markup added for the 2026-10 no-ellipsis reply bug.
    const replyHtml = String(sent[0].bodyHtml ?? '')
    assert(
      replyHtml.includes('gmail_quote_container') && replyHtml.includes('<blockquote class="gmail_quote"'),
      `reply html uses gmail native quote structure (${replyHtml.slice(0, 140)})`,
      'reply html missing gmail native quote structure'
    )
    assert(
      replyHtml.includes('wrote:') && replyHtml.includes('<p>Final review of the launch checklist before Friday.</p>'),
      `reply quotes the original html body (${replyHtml.slice(0, 140)})`,
      'reply dropped the original html body'
    )
    // Forward path: opens prefilled composer, cancel discards without sending.
    await page.getByRole('button', { name: 'forward', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    const fwdSubject = await page.locator('.composerField input').nth(1).inputValue()
    assert(fwdSubject === 'Fwd: Launch checklist', `forward prefills subject (${fwdSubject})`, 'forward subject not prefilled')
    await page.getByRole('button', { name: 'Cancel' }).click()
    const sentAfter = await page.evaluate(() => window.__sent)
    assert(sentAfter.length === 1, 'cancelled forward not sent', 'cancelled forward was sent')
    // Pins the forwarded-html fix for the 2026-10 plain-text-forward bug.
    await page.getByRole('button', { name: 'forward', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    await page.locator('.composerField input').first().fill('ada@example.com')
    await typeAtStart(page.locator('.body-editor'), 'forwarding for the record.\n\n')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('status').getByText('Message sent.').waitFor({ timeout: 10000 })
    const sentForward = await page.evaluate(() => window.__sent)
    assert(sentForward.length === 2, 'forward sent as second outbox record', 'forward was not sent')
    const forwardHtml = String(sentForward[1].bodyHtml ?? '')
    assert(
      forwardHtml.includes('Forwarded message') && forwardHtml.includes('gmail_quote_container'),
      `forward html carries the banner and quote structure (${forwardHtml.slice(0, 140)})`,
      'forward banner or quote structure missing'
    )
    assert(
      forwardHtml.includes('<p>Final review of the launch checklist before Friday.</p>'),
      `forward preserves the original html body (${forwardHtml.slice(0, 140)})`,
      'forward dropped the original html body'
    )
    await snapshot(page, 'compose-send')
    return 'compose-send'
  })
  journeys.set('compose-new', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const starter = await page.evaluate(() => (window.__sent ?? []).length)
    assert(starter === 0, 'outbox starts empty', 'outbox not empty at journey start')
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    const toValue = await content.locator('.composerField input').first().inputValue()
    assert(toValue === '', `fresh compose opens with a blank To (${toValue})`, 'To not blank on open')
    // While To is blank the Send button is disabled: blocking, not a stuck composer.
    assert(
      await content.getByRole('button', { name: 'Send', exact: true }).isDisabled(),
      'Send stays disabled while To is blank',
      'Send was enabled with a blank To'
    )
    // Type something, then cancel: nothing may reach the outbox, and the
    // pane falls back to the idle state.
    await content.locator('.composerField input').first().fill('ada@example.com')
    await content.getByRole('button', { name: 'Cancel', exact: true }).click()
    await content.getByText('Nothing open yet :P').waitFor({ timeout: 10000 })
    assert(true, 'cancel closes the composer back to the idle pane', 'composer stayed open after cancel')
    assert(
      (await page.evaluate(() => (window.__sent ?? []).length)) === 0,
      'cancel sent nothing',
      'cancelled compose reached the outbox'
    )
    // Reopen: a fresh form, not the discarded fields.
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    const reopenedTo = await content.locator('.composerField input').first().inputValue()
    assert(reopenedTo === '', `reopened composer starts blank (${reopenedTo})`, 'discarded fields survived into the fresh composer')
    await content.locator('.composerField input').first().fill('ada@example.com')
    await content.locator('.composerField input').nth(1).fill('Fresh note from Mailsy')
    await content.locator('.body-editor').fill('First message sent from the fresh composer.')
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    assert(true, '"Message sent." status appears', 'send status missing')
    // Boundary proof: read back the mock's recorded outbox after the status.
    const sent = await page.evaluate(() => window.__sent)
    const record = sent[sent.length - 1]
    assert(
      sent.length === 1 &&
        record.to === 'ada@example.com' &&
        record.subject === 'Fresh note from Mailsy' &&
        record.body.includes('First message sent from the fresh composer.'),
      `outbox recorded the fresh send ${JSON.stringify(record)}`,
      'outbox missing or wrong fresh-send record'
    )
    // A fresh message carries no threading fields: no thread id, no reply
    // headers, no draft id. The typed request shape is the fresh marker.
    assert(
      record.threadId === undefined && record.inReplyTo === undefined && record.draftId === undefined,
      'fresh send carries no thread/reply/draft fields',
      'fresh send was misshapen as a reply or draft'
    )
    await snapshot(page, 'compose-new')
    return 'compose-new'
  })
  journeys.set('forward-attachments', async () => {
    const { collectBodies } = await import(resolve(SKILL_DIR, '../../../src/main/mail/mime.ts'))
    const content = page.getByRole('region', { name: 'Email content' })
    const form = content.locator('form.composer')
    const send = form.getByRole('button', { name: 'Send', exact: true })
    for (const scenario of [
      'inline-data',
      'all',
      'remove',
      'retry',
      'remove-failed',
      'switch',
      'reply',
      'reply-all'
    ]) {
      if (scenario !== 'inline-data') await page.reload()
      await page.getByText('Launch checklist', { exact: true }).first().waitFor()
      if (scenario === 'inline-data') {
        const bodies = { text: '', html: '', inlineImages: [], attachments: [] }
        collectBodies(await page.evaluate(() => window.__inlineAttachmentPayload), bodies)
        await page.evaluate((refs) => {
          const getThread = (window.__packagedFixtureApi ?? window.api).getThread
          window.__forwardInlineId = refs[0]?.attachmentId
          ;(window.__packagedFixtureApi ?? window.api).getThread = async (id) => {
            const thread = await getThread(id)
            thread.messages = thread.messages.map((message) =>
              message.id === 'msg-receipts-1'
                ? { ...message, attachments: [...message.attachments, ...refs] }
                : message
            )
            return thread
          }
        }, bodies.attachments)
      }
      await page.evaluate((scenario) => {
        const getAttachment = (window.__packagedFixtureApi ?? window.api).getAttachment
        window.__forwardMode = ['retry', 'remove-failed'].includes(scenario)
          ? 'fail'
          : scenario === 'switch'
            ? 'hold'
            : 'ok'
        window.__forwardExpected = {}
        ;(window.__packagedFixtureApi ?? window.api).getAttachment = async (messageId, attachmentId) => {
          const data = await getAttachment(messageId, attachmentId)
          if (messageId === 'msg-receipts-1') window.__forwardExpected[attachmentId] = data
          if (attachmentId === 'att-receipts-1') {
            if (window.__forwardMode === 'fail') throw new Error('Fixture original unavailable')
            if (window.__forwardMode === 'hold') {
              await new Promise((resolve) => {
                window.__releaseForward = resolve
              })
              window.__forwardReleased = true
            }
          }
          return data
        }
      }, scenario)
      await page
        .getByRole('complementary', { name: 'Inbox' })
        .getByRole('button', { name: /^Receipts for March travel/ })
        .click()
      const action =
        scenario === 'reply' ? 'reply' : scenario === 'reply-all' ? 'reply all' : 'forward'
      await content.getByRole('button', { name: action, exact: true }).click()
      if (action === 'forward')
        await form.getByLabel('To', { exact: true }).fill('forward@example.com')
      if (scenario === 'remove') {
        await form.getByRole('button', { name: 'Remove receipt-b.pdf', exact: true }).click()
      } else if (scenario === 'retry' || scenario === 'remove-failed') {
        await form.getByRole('alert').filter({ hasText: 'Could not load: receipt-a.pdf' }).waitFor()
        assert(
          await send.isDisabled(),
          'a failed forward original blocks Send',
          'a failed forward original allowed Send'
        )
        await form.evaluate((element) => element.requestSubmit())
        assert(
          await page.evaluate(() => window.__sent.length === 0),
          'submit cannot omit a failed forward original',
          'submit bypassed the failed-original protection'
        )
        await snapshot(page, `forward-attachments-${scenario}-failed`)
        if (scenario === 'retry') {
          await page.evaluate(() => {
            window.__forwardMode = 'hold'
          })
          await form.getByRole('button', { name: 'Retry receipt-a.pdf', exact: true }).click()
          await page.waitForFunction(() => typeof window.__releaseForward === 'function')
          assert(
            (await send.isDisabled()) &&
              (await form.getByRole('button', { name: 'Attach files', exact: true }).isDisabled()),
            'Retry loading blocks Send and picking',
            'Retry loading allowed Send or picking'
          )
          await snapshot(page, 'forward-attachments-retrying')
          await page.evaluate(() => window.__releaseForward())
          await form
            .getByRole('button', { name: 'Retry receipt-a.pdf', exact: true })
            .waitFor({ state: 'detached' })
        } else {
          await form.getByRole('button', { name: 'Remove receipt-a.pdf', exact: true }).click()
        }
        assert(
          (await form.getByRole('alert').count()) === 0,
          'resolving the failed original clears its error',
          'the resolved original retained an error'
        )
      } else if (scenario === 'switch') {
        await page.waitForFunction(() => typeof window.__releaseForward === 'function')
        assert(
          await send.isDisabled(),
          'loading forward originals blocks Send',
          'pending forward originals allowed Send'
        )
        await content.getByRole('button', { name: 'reply', exact: true }).click()
        await page.evaluate(() => window.__releaseForward())
        await page.waitForFunction(() => window.__forwardReleased === true)
        assert(
          (await form.locator('.attachmentChip').count()) === 0 && (await send.isEnabled()),
          'switching to reply discards a pending forward attachment set',
          'late forward originals leaked into reply'
        )
      }
      const chipNames = await form.locator('.attachmentChip').allTextContents()
      await snapshot(page, `forward-attachments-${scenario}-ready`)
      await send.click()
      await content.getByText('Message sent.', { exact: true }).waitFor()
      const expectedNames =
        scenario === 'remove'
          ? ['receipt-a.pdf', 'cal-shot.png']
          : scenario === 'remove-failed'
            ? ['receipt-b.pdf', 'cal-shot.png']
            : ['reply', 'reply-all', 'switch'].includes(scenario)
              ? []
              : scenario === 'inline-data'
                ? ['receipt-a.pdf', 'receipt-b.pdf', 'cal-shot.png', 'tiny-note.bin']
                : ['receipt-a.pdf', 'receipt-b.pdf', 'cal-shot.png']
      assert(
        (await page.evaluate((names) => {
          const files = window.__sent[0]?.attachments ?? []
          const ids = {
            'receipt-a.pdf': 'att-receipts-1',
            'receipt-b.pdf': 'att-receipts-2',
            'cal-shot.png': 'att-receipts-img',
            'tiny-note.bin': window.__forwardInlineId
          }
          return (
            window.__sent.length === 1 &&
            files.length === names.length &&
            names.every((name) =>
              files.some(
                (file) =>
                  file.filename === name &&
                  file.data === window.__forwardExpected[ids[name]] &&
                  (name !== 'tiny-note.bin' || file.data === '+/8=')
              )
            )
          )
        }, expectedNames)) && chipNames.length === expectedNames.length,
        `${scenario}: removable chips and sent bytes match ${expectedNames.length} originals`,
        `${scenario}: forward/reply attachment chips or sent bytes do not match ${expectedNames.length} originals`
      )
      if (action === 'forward' && scenario !== 'switch') {
        assert(
          await page.evaluate(
            () =>
              window.__sent[0].bodyHtml?.includes('Forwarded message') &&
              window.__sent[0].bodyHtml?.includes(
                '<p>Two receipts attached from the March travel batch.</p>'
              )
          ),
          'forwarded quoted HTML is preserved',
          'forwarding changed or dropped the quoted HTML'
        )
      }
    }
    return 'forward-attachments'
  })
  journeys.set('draft-attachments-safe', async () => {
    const content = page.getByRole('region', { name: 'Email content' })
    const send = content.getByRole('button', { name: 'Send', exact: true })
    const pick = content.getByRole('button', { name: 'Attach files', exact: true })
    await page.getByText('Launch checklist', { exact: true }).first().waitFor()
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000))

    for (const scenario of [
      'loading',
      'rotate',
      'rotate-queued',
      'edit',
      'remove',
      'retry',
      'save-error',
      'limit',
      'limit-draft',
      'limit-reply',
      'limit-forward'
    ]) {
      if (arg('attachment-case') && arg('attachment-case') !== scenario) continue
      if (scenario !== 'loading') {
        await page.reload()
        await page.getByText('Launch checklist', { exact: true }).first().waitFor()
      }
      if (!scenario.startsWith('limit')) {
        await page.evaluate(
          (mode) => {
            const getAttachment = (window.__packagedFixtureApi ?? window.api).getAttachment
            const pickAttachments = (window.__packagedFixtureApi ?? window.api).pickAttachments
            window.__readStoredAttachment = getAttachment
            window.__attachmentMode = mode
            window.__attachmentReads = 0
            window.__attachmentPicks = 0
            ;(window.__packagedFixtureApi ?? window.api).getAttachment = async (...args) => {
              window.__attachmentReads++
              if (window.__attachmentMode === 'fail')
                throw new Error('Fixture attachment unavailable')
              const data = await getAttachment(...args)
              if (window.__attachmentMode === 'hold') {
                return new Promise((resolve) => {
                  window.__releaseAttachment = () => resolve(data)
                })
              }
              return data
            }
            ;(window.__packagedFixtureApi ?? window.api).pickAttachments = async () => {
              window.__attachmentPicks++
              return pickAttachments()
            }
          },
          scenario === 'loading' ? 'hold' : 'fail'
        )
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Drafts', exact: true })
          .click()
        await page
          .getByRole('complementary', { name: 'Drafts' })
          .getByRole('button', {
            name: scenario.startsWith('rotate')
              ? /^Draft: rotating originals/
              : /^Draft: Q4 attachments/
          })
          .click()
        await content.getByLabel('Subject', { exact: true }).waitFor()
      }
      if (scenario === 'loading') {
        await page.waitForFunction(() => typeof window.__releaseAttachment === 'function')
        await content.getByLabel('Subject', { exact: true }).fill('Held attachment draft')
        await page.clock.fastForward(1800)
        await snapshot(page, 'draft-attachments-loading')
        assert(
          (await send.isDisabled()) &&
            (await page.evaluate(() =>
              window.__draftSaves.some(
                (save) =>
                  save.subject === 'Held attachment draft' &&
                  save.retainAttachments?.refs[0]?.filename === 'q4.xlsx'
              )
            )),
          'autosave while loading carries retained originals and keeps Send blocked',
          'autosave while loading did not retain originals'
        )
        assert(
          await page.evaluate(async () => {
            const stored = await (window.__packagedFixtureApi ?? window.api).getMessage(window.__draftSaves.at(-1).messageId)
            const ref = stored.attachments[0]
            return (
              stored.subject === 'Held attachment draft' &&
              stored.attachments.length === 1 &&
              ref.filename === 'q4.xlsx' &&
              (await window.__readStoredAttachment(stored.id, ref.attachmentId)) ===
                'UTQgcGxhbm5pbmcgZGF0YQ=='
            )
          }),
          'the save made during loading preserves stored original bytes',
          'the save made during loading stripped original bytes'
        )
        assert(
          await pick.isDisabled(),
          'picking is disabled until originals load',
          'picking is enabled during prefill'
        )
        await pick.evaluate((button) => button.click())
        await content.locator('form.composer').evaluate((form) => form.requestSubmit())
        assert(
          (await page.evaluate(() => window.__attachmentPicks)) === 0 &&
            (await page.evaluate(() => window.__sent.length)) === 0,
          'blocked controls cannot pick or send before prefill settles',
          'a blocked pick or submit reached the boundary'
        )
        await content.locator('form.composer').evaluate((form) => {
          const dataTransfer = new DataTransfer()
          dataTransfer.items.add(new File(['held drop'], 'held.txt', { type: 'text/plain' }))
          form.dispatchEvent(
            new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
          )
        })
        await content.getByRole('alert').filter({ hasText: 'still loading' }).waitFor()
        await page.evaluate(() => window.__releaseAttachment())
        await content.getByRole('button', { name: 'Remove q4.xlsx', exact: true }).waitFor()
        await pick.click()
        await content
          .getByRole('button', { name: 'Remove fixture-file.pdf', exact: true })
          .waitFor()
        await send.click()
        await content.getByText('Message sent.', { exact: true }).waitFor()
        assert(
          await page.evaluate(() => {
            const files = window.__sent[0]?.attachments ?? []
            return (
              window.__attachmentPicks === 1 &&
              files.length === 2 &&
              files.some(
                (file) => file.filename === 'q4.xlsx' && file.data === 'UTQgcGxhbm5pbmcgZGF0YQ=='
              ) &&
              files.some(
                (file) => file.filename === 'fixture-file.pdf' && file.data === 'Zml4dHVyZQ=='
              )
            )
          }),
          'picking after loading sends both the original and the picked bytes',
          'loading or picking lost attachment bytes'
        )
      } else if (scenario === 'rotate') {
        await content.getByRole('button', { name: 'Retry first.bin', exact: true }).waitFor()
        await content.getByLabel('Subject', { exact: true }).fill('Rotated once')
        await page.clock.fastForward(1800)
        await page.waitForFunction(() => window.__draftSaves.length === 1)
        await page.clock.fastForward(3600)
        assert(
          await page.evaluate(() => window.__draftSaves.length === 1),
          'adopting replacement refs does not create an autosave loop',
          'identity-only changes caused extra saves'
        )
        assert(
          await page.evaluate(async () => {
            try {
              await window.__readStoredAttachment('msg-rotating', 'rotate-a')
              return false
            } catch {
              return true
            }
          }),
          'saving retires the old message and attachment ids',
          'the fixture kept old attachment ids alive'
        )
        await page.evaluate(() => {
          window.__attachmentMode = 'ok'
        })
        await content.getByRole('button', { name: 'Retry first.bin', exact: true }).click()
        await content
          .getByRole('button', { name: 'Retry first.bin', exact: true })
          .waitFor({ state: 'detached' })
        assert(
          (await content.getByRole('button', { name: 'Remove first.bin', exact: true }).count()) ===
            1 &&
            (await content
              .getByRole('button', { name: 'Retry first.bin', exact: true })
              .count()) === 0,
          'Retry succeeds using the replacement message and attachment ids',
          'Retry after saved message replacement did not load the original'
        )
        await content.getByLabel('Subject', { exact: true }).fill('Rotated twice')
        await page.clock.fastForward(1800)
        await page.waitForFunction(() => window.__draftSaves.length >= 2)
        assert(
          await page.evaluate(() => {
            const [first, second] = window.__draftSaves
            return (
              second.subject === 'Rotated twice' &&
              second.retainAttachments.messageId === first.messageId &&
              second.retainAttachments.refs.length === 1 &&
              second.retainAttachments.refs[0].filename === 'second.bin'
            )
          }),
          'the next autosave retains the remaining original using refreshed refs',
          'the next autosave used stale original refs'
        )
        await content.getByRole('button', { name: 'Retry second.bin', exact: true }).click()
        await page.waitForFunction(
          () => !document.querySelector('button[aria-label="Retry second.bin"]')
        )
        await send.click()
        await content.getByText('Message sent.', { exact: true }).waitFor()
        assert(
          await page.evaluate(
            () =>
              window.__sent[0]?.attachments?.length === 2 &&
              window.__sent[0].attachments.some(
                (file) => file.filename === 'first.bin' && file.data === 'Zmlyc3Q='
              ) &&
              window.__sent[0].attachments.some(
                (file) => file.filename === 'second.bin' && file.data === 'c2Vjb25k'
              )
          ),
          'both originals still send after successive message replacements',
          'a replacement lost original bytes'
        )
        await snapshot(page, 'draft-attachments-rotated')
      } else if (scenario === 'rotate-queued') {
        await content.getByRole('button', { name: 'Retry first.bin', exact: true }).waitFor()
        await page.evaluate(() => {
          const saveDraft = (window.__packagedFixtureApi ?? window.api).saveDraft
          let first = true
          ;(window.__packagedFixtureApi ?? window.api).saveDraft = async (request) => {
            const result = await saveDraft(request)
            if (first) {
              first = false
              await new Promise((resolve) => {
                window.__releaseSavedDraft = resolve
              })
            }
            return result
          }
        })
        await content.getByLabel('Subject', { exact: true }).fill('First queued edit')
        await page.clock.fastForward(1800)
        await page.waitForFunction(() => typeof window.__releaseSavedDraft === 'function')
        await content.getByRole('button', { name: 'Remove first.bin', exact: true }).click()
        await content.getByLabel('Subject', { exact: true }).fill('Dismissed queued edit')
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Inbox', exact: true })
          .click()
        await page.evaluate(() => window.__releaseSavedDraft())
        await page.waitForFunction(() => window.__draftSaves.length === 2)
        assert(
          await page.evaluate(async () => {
            const [first, second] = window.__draftSaves
            const stored = await (window.__packagedFixtureApi ?? window.api).getMessage(second.messageId)
            return (
              second.subject === 'Dismissed queued edit' &&
              second.retainAttachments.messageId === first.messageId &&
              stored.attachments.length === 1 &&
              stored.attachments[0].filename === 'second.bin'
            )
          }),
          'a queued unmount save rebases ids without resurrecting a removed original',
          'a queued save lost edits or restored removed originals'
        )
        await snapshot(page, 'draft-attachments-rotated-queued')
      } else if (scenario === 'edit') {
        await content.getByRole('alert').filter({ hasText: 'Could not load: q4.xlsx' }).waitFor()
        await content.getByLabel('Subject', { exact: true }).fill('Edits survive failed originals')
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Inbox', exact: true })
          .click()
        await page.clock.fastForward(1800)
        assert(
          await page.evaluate(() =>
            window.__draftSaves.some(
              (save) =>
                save.subject === 'Edits survive failed originals' &&
                save.retainAttachments?.refs.length === 1
            )
          ),
          'leaving a failed-load draft flushes edits with retained originals',
          'leaving a failed-load draft lost the edit or original refs'
        )
        await page.evaluate(() => {
          window.__attachmentMode = 'ok'
        })
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Drafts', exact: true })
          .click()
        await page
          .getByRole('complementary', { name: 'Drafts' })
          .getByRole('button', { name: /^Edits survive failed originals/ })
          .click()
        await content.getByRole('button', { name: 'Remove q4.xlsx', exact: true }).waitFor()
        assert(
          (await content.getByLabel('Subject', { exact: true }).inputValue()) ===
            'Edits survive failed originals',
          'reopening keeps the edited subject and original attachment',
          'reopening lost the edit or attachment'
        )
        await snapshot(page, 'draft-attachments-edits-reopened')
      } else if (scenario === 'remove') {
        await content.getByRole('alert').filter({ hasText: 'Could not load: q4.xlsx' }).waitFor()
        assert(
          await send.isDisabled(),
          'a failed original blocks Send',
          'a failed original allowed Send'
        )
        await snapshot(page, 'draft-attachments-failed')
        await content.getByRole('button', { name: 'Remove q4.xlsx', exact: true }).click()
        await page.clock.fastForward(1800)
        assert(
          await page.evaluate(() =>
            window.__draftSaves.some(
              (save) => !save.attachments?.length && !save.retainAttachments?.refs.length
            )
          ),
          'removing every failed original saves without any other edit',
          'removing every failed original did not trigger a save'
        )
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Inbox', exact: true })
          .click()
        await page
          .getByRole('navigation', { name: 'Mail folders' })
          .getByRole('button', { name: 'Drafts', exact: true })
          .click()
        await page
          .getByRole('complementary', { name: 'Drafts' })
          .getByRole('button', { name: /^Draft: Q4 attachments/ })
          .click()
        await content.getByLabel('Subject', { exact: true }).waitFor()
        assert(
          (await content.locator('.attachmentChip').count()) === 0 && (await send.isEnabled()),
          'reopening does not resurrect explicitly removed originals',
          'the removed original returned on reopen'
        )
        await send.click()
        await content.getByText('Message sent.', { exact: true }).waitFor()
        assert(
          await page.evaluate(
            () => window.__sent.length === 1 && !window.__sent[0].attachments?.length
          ),
          'explicit Remove permits sending an empty attachment set',
          'the removed original remained in the sent request'
        )
      } else if (scenario === 'retry') {
        await content.getByRole('alert').filter({ hasText: 'Could not load: q4.xlsx' }).waitFor()
        await content.getByLabel('Subject', { exact: true }).fill('Retry the original')
        const readsBeforeRetry = await page.evaluate(() => window.__attachmentReads)
        await content.getByRole('button', { name: 'Retry q4.xlsx', exact: true }).click()
        await page.waitForFunction((before) => window.__attachmentReads > before, readsBeforeRetry)
        await page.clock.fastForward(1)
        assert(
          await send.isDisabled(),
          'an unsuccessful Retry leaves the original protected',
          'an unsuccessful Retry unblocked sending'
        )
        await page.evaluate(() => {
          window.__attachmentMode = 'ok'
        })
        await content.getByRole('button', { name: 'Retry q4.xlsx', exact: true }).click()
        await content
          .getByRole('button', { name: 'Retry q4.xlsx', exact: true })
          .waitFor({ state: 'detached' })
        await page.clock.fastForward(1800)
        await page.waitForFunction(() =>
          window.__draftSaves.some((save) => save.attachments?.length === 1)
        )
        await send.click()
        await content.getByText('Message sent.', { exact: true }).waitFor()
        assert(
          (await page.evaluate(
            () => window.__sent[0]?.attachments?.[0]?.data === 'UTQgcGxhbm5pbmcgZGF0YQ=='
          )) && (await content.getByRole('alert').count()) === 0,
          'successful Retry restores the original bytes and clears its error',
          'Retry lost the original bytes or retained its error'
        )
        await snapshot(page, 'draft-attachments-retried')
      } else if (scenario === 'save-error') {
        await content.getByRole('alert').filter({ hasText: 'Could not load: q4.xlsx' }).waitFor()
        await page.evaluate(() => {
          window.__retainAttachmentError = 'Stored original unavailable'
        })
        await content.getByLabel('Subject', { exact: true }).fill('Cannot save without originals')
        await page.clock.fastForward(1800)
        await content
          .getByRole('alert')
          .filter({ hasText: 'Stored original unavailable' })
          .waitFor()
        assert(
          await page.evaluate(async () => {
            const stored = await (window.__packagedFixtureApi ?? window.api).getMessage('msg-draft-q4')
            return (
              window.__draftSaves.length === 0 &&
              stored.subject === 'Draft: Q4 attachments' &&
              stored.attachments.length === 1
            )
          }),
          'a retained fetch failure leaves the saved draft untouched',
          'a failed save stripped or changed the stored draft'
        )
        await snapshot(page, 'draft-attachments-save-error')
      } else {
        if (scenario === 'limit') {
          await page.getByRole('button', { name: 'Compose', exact: true }).click()
        } else if (scenario === 'limit-draft') {
          await page
            .getByRole('navigation', { name: 'Mail folders' })
            .getByRole('button', { name: 'Drafts', exact: true })
            .click()
          await page
            .getByRole('complementary', { name: 'Drafts' })
            .getByRole('button', { name: /^Draft: Q4 planning notes/ })
            .click()
        } else {
          await page
            .getByRole('complementary', { name: 'Inbox' })
            .getByRole('button', { name: /^Launch checklist/ })
            .click()
          await content
            .getByRole('button', {
              name: scenario === 'limit-reply' ? 'reply' : 'forward',
              exact: true
            })
            .click()
        }
        await content.getByLabel('To', { exact: true }).fill('test@example.com')
        await content.locator('form.composer').evaluate((form) => {
          for (let i = 0; i < 2; i++) {
            const dataTransfer = new DataTransfer()
            dataTransfer.items.add(
              new File([new Uint8Array(12 * 1024 * 1024)], `large-${i}.bin`, {
                type: 'application/octet-stream'
              })
            )
            form.dispatchEvent(
              new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
            )
          }
        })
        await content
          .getByRole('alert')
          .filter({ hasText: 'Attachments are too large to send (24 MB)' })
          .waitFor()
        assert(
          (await content.locator('.attachmentChip').count()) === 1,
          `${scenario}: concurrent 12 MiB drops reject the addition that exceeds 20 MiB`,
          `${scenario}: concurrent drops bypassed the cumulative attachment limit`
        )
        await snapshot(page, `draft-attachments-${scenario}`)
        await send.click()
        await content.getByText('Message sent.', { exact: true }).waitFor()
        assert(
          await page.evaluate(
            () =>
              window.__sent[0]?.attachments?.length === 1 &&
              window.__sent[0].attachments[0].size === 12 * 1024 * 1024
          ),
          `${scenario}: the accepted file still sends after the over-limit addition is rejected`,
          `${scenario}: rejecting an over-limit addition lost the accepted file`
        )
      }
    }
    return 'draft-attachments-safe'
  })
  journeys.set('attachments', async () => {
    // Compose flow: two entrances into the same set. A drag drops in first
    // (a real DragEvent carrying a constructed File — the same handler a
    // Finder drag lands in), then the picker through the mock's canned
    // file. Send carries both. Then chip removal, then the draft round
    // trip, then the read view.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    // Drag entrance, hover state first: the form draws the dashed outline
    // while a file drag hovers over the whole composer box.
    await page.evaluate(() => {
      const form = document.querySelector('form.composer')
      const dt = new DataTransfer()
      dt.items.add(new File(['dropped note'], 'meeting-notes.txt', { type: 'text/plain' }))
      form.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
      form.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }))
    })
    await content.locator('form.composer-dragging').waitFor({ timeout: 10000 })
    await page.evaluate(() => {
      const form = document.querySelector('form.composer')
      const dt = new DataTransfer()
      dt.items.add(new File(['dropped note'], 'meeting-notes.txt', { type: 'text/plain' }))
      form.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
    })
    const dropChip = content.locator('.attachmentChip', { hasText: 'meeting-notes.txt' })
    await dropChip.waitFor({ timeout: 10000 })
    const dropSize = (await dropChip.locator('.attachmentChip-size').textContent())?.trim()
    assert(
      dropSize === '12 B',
      'the dropped file joins the set like a picked one',
      `dropped chip wrong (${dropSize})`
    )
    await content.getByRole('button', { name: 'Attach files' }).click()
    const chip = content.locator('.attachmentChip', { hasText: 'fixture-file.pdf' })
    await chip.waitFor({ timeout: 10000 })
    const chipSize = (await chip.locator('.attachmentChip-size').textContent())?.trim()
    assert(
      chipSize === '7 B',
      'chip labels the picked file size',
      `chip size label wrong (${chipSize})`
    )
    await content.locator('.composerField input').first().fill('ada@example.com')
    await content.locator('.composerField input').nth(1).fill('Report attached')
    await content.locator('.body-editor').fill('The report is attached.')
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const sent = await page.evaluate(() => window.__sent)
    const withFile = sent[sent.length - 1]
    assert(
      sent.length === 1 &&
        withFile.subject === 'Report attached' &&
        withFile.attachments?.length === 2 &&
        withFile.attachments[0].filename === 'meeting-notes.txt' &&
        withFile.attachments[0].data === 'ZHJvcHBlZCBub3Rl' &&
        withFile.attachments[1].filename === 'fixture-file.pdf' &&
        withFile.attachments[1].data === 'Zml4dHVyZQ==',
      `outbox carries the drop and the pick ${JSON.stringify(withFile)}`,
      'send lost an attachment'
    )
    // Chip removal: close the retired pane like a user would, open a fresh
    // compose, pick, remove, and send — no bytes ride the second send.
    await content.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'Attach files' }).click()
    await chip.waitFor({ timeout: 10000 })
    await chip.getByRole('button').click()
    assert(
      (await content.locator('.attachmentChip').count()) === 0,
      'the chip row drops the removed file',
      'chip survived the remove control'
    )
    await content.locator('.composerField input').first().fill('ada@example.com')
    await content.locator('.composerField input').nth(1).fill('No file now')
    await content.locator('.body-editor').fill('Nothing attached.')
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const sentTwo = await page.evaluate(() => window.__sent)
    assert(
      sentTwo.length === 2 && sentTwo[1].attachments === undefined,
      'stripped send carries no attachments',
      'removed file still rode the send'
    )
    // Draft round trip: the seeded draft carries a ref, so reopening
    // resolves it through getAttachment before the autosave arms.
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Draft: Q4 attachments').first().click()
    const draftForm = page.getByRole('region', { name: 'Email content' })
    await draftForm.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const storedChip = draftForm.locator('.attachmentChip', { hasText: 'q4.xlsx' })
    await storedChip.waitFor({ timeout: 10000 })
    assert(true, 'reopened draft resolves its stored attachment', 'stored draft attachment chip missing')
    const beforeSends = await page.evaluate(() => (window.__sent ?? []).length)
    await draftForm.getByRole('button', { name: 'Send', exact: true }).click()
    await draftForm.getByText('Message sent.').waitFor({ timeout: 10000 })
    const sentThree = await page.evaluate(() => window.__sent)
    const draftRecord = sentThree[sentThree.length - 1]
    assert(
      sentThree.length === beforeSends + 1 &&
        draftRecord.attachments?.length === 1 &&
        draftRecord.attachments[0].filename === 'q4.xlsx' &&
        draftRecord.attachments[0].data === 'UTQgcGxhbm5pbmcgZGF0YQ==',
      `draft send carries the resolved bytes ${JSON.stringify(draftRecord)}`,
      'draft send lost or reshaped the stored attachment'
    )
    // Read view: the message's own files render under the body of the
    // conversation view, listed from the refs a boundary fetch carries.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    const inboxRows = page.getByRole('complementary', { name: 'Inbox' })
    await inboxRows.waitFor({ timeout: 10000 })
    await inboxRows.getByText('Receipts for March travel').first().click()
    const detail = page.getByRole('region', { name: 'Email content' })
    const readChips = detail.locator('.attachmentChip-save')
    await readChips.first().waitFor({ timeout: 10000 })
    assert(
      (await readChips.count()) === 2 &&
        (await readChips.nth(0).textContent())?.includes('receipt-a.pdf') &&
        (await readChips.nth(1).textContent())?.includes('receipt-b.pdf'),
      `the read view lists the stored files (count ${await readChips.count()})`,
      'read-view chips missing or wrong'
    )
    // A chip is its save affordance: clicking it drives the save verb with
    // the ref's ids and name, the record the real main would dialog from.
    await readChips.nth(0).click()
    await page.waitForFunction(() => (window.__saves ?? []).length >= 1, undefined, {
      timeout: 10000
    })
    const saves = await page.evaluate(() => window.__saves)
    assert(
      saves.length === 1 &&
        saves[0].messageId === 'msg-receipts-1' &&
        saves[0].attachmentId === 'att-receipts-1' &&
        saves[0].filename === 'receipt-a.pdf',
      `the chip click saves the file ${JSON.stringify(saves)}`,
      'the read-view chip did not drive the save verb'
    )
    await snapshot(page, 'attachments')
    return 'attachments'
  })
  journeys.set('inline-images', async () => {
    // The rich compose body: a dropped image lands inside the text like
    // Gmail's inline images, with editable text above and below it, the
    // send carries the html with the data URL, the draft autosave
    // round-trips the image through the stored draft, and the read view
    // previews a received image attachment inline instead of a save chip.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('ada@example.com')
    await content.locator('.composerField input').nth(1).fill('Inline shot sent')
    // A typed line first: the image must land without eating it.
    await content.locator('.body-editor').fill('Invoice snapshot below.')
    // Synthetic drag onto the editor surface itself (not the composer
    // form): an image file plus a non-image one in the same drop, so the
    // routing rule shows in one gesture — image into the body, text file
    // into the chips.
    await page.evaluate(() => {
      const editor = document.querySelector('.body-editor')
      const dt = new DataTransfer()
      // A real 1x1 PNG, matching the read-view seed's bytes.
      const bytes = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
        (character) => character.charCodeAt(0)
      )
      dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
      dt.items.add(new File(['note text'], 'keep-as-chip.txt', { type: 'text/plain' }))
      editor.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
    })
    const inlineImg = content.locator('.body-editor img')
    await inlineImg.waitFor({ timeout: 10000 })
    const imgSrc = await inlineImg.getAttribute('src')
    assert(
      imgSrc?.startsWith('data:image/png;base64,'),
      `the dropped image sat in the body (${(imgSrc ?? '').slice(0, 30)}…...)`,
      'dropped image did not land in the rich body'
    )
    const chip = content.locator('.attachmentChip', { hasText: 'keep-as-chip.txt' })
    await chip.waitFor({ timeout: 10000 })
    assert(true, 'the non-image file in the same drop stayed an attachment chip', 'non-image file lost its chip routing')
    // Text types below the image too: the caret collapsed after it.
    await typeAtEnd(content.locator('.body-editor'), '\nThen the packages arrived.')
    const editorText = await bodyTextOf(content.locator('.body-editor'))
    assert(
      editorText.includes('Invoice snapshot below.') && editorText.includes('Then the packages arrived.'),
      `text stays editable around the image (${editorText.slice(0, 80)})`,
      'the image destroyed the editable text around it'
    )
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const sent = await page.evaluate(() => window.__sent)
    const record = sent[sent.length - 1]
    assert(
      sent.length === 1 &&
        record.subject === 'Inline shot sent' &&
        String(record.bodyHtml ?? '').includes('data:image/png;base64,') &&
        record.body.includes('Invoice snapshot below.') &&
        record.body.includes('Then the packages arrived.'),
      `outbox carries html with the data URL and the text ${JSON.stringify(record).slice(0, 160)}`,
      'send lost the inline image or the body text'
    )
    // The non-image chip rides the send separately from the body html.
    assert(
      record.attachments?.length === 1 && record.attachments[0].filename === 'keep-as-chip.txt',
      'the chip file rode the send next to the inline image',
      'chip file not carried'
    )
    // Draft round trip: a separate compose that is never sent autosaves
    // with the image inside; reopening the stored draft shows it again
    // because the autosave carried the rich body html.
    await content.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('brook@example.com')
    await content.locator('.composerField input').nth(1).fill('Inline shot draft')
    await page.evaluate(() => {
      const editor = document.querySelector('.body-editor')
      const dt = new DataTransfer()
      const bytes = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
        (character) => character.charCodeAt(0)
      )
      dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
      editor.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
    })
    await content.locator('.body-editor img').waitFor({ timeout: 10000 })
    // Close the pane without Send or Cancel: the autosave is the only
    // carrier. A row click walks away the way an accidental close does.
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Inline shot draft', { exact: true }).first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const restoredImg = content.locator('.body-editor img')
    await restoredImg.waitFor({ timeout: 10000 })
    const restoredSrc = await restoredImg.getAttribute('src')
    assert(
      restoredSrc?.startsWith('data:image/png;base64,'),
      'the inline image survived the draft round trip',
      'draft reopen lost the inline image'
    )
    // Read view: a received image attachment previews inline, not as a
    // save dialog, while the non-image chips keep their save affordance.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Receipts for March travel').first().click()
    const preview = content.locator('.readAttachment-preview img')
    await preview.waitFor({ timeout: 10000 })
    const previewSrc = await preview.getAttribute('src')
    assert(
      previewSrc?.startsWith('data:image/png;base64,'),
      'received image previews inline with its bytes rendered',
      'image attachment did not preview inline'
    )
    const readChips = content.locator('.attachmentChip-save')
    await readChips.first().waitFor({ timeout: 10000 })
    assert(
      (await readChips.count()) === 2,
      'non-image attachments keep their chips beside the preview',
      'read-view chips changed alongside the preview'
    )
    await snapshot(page, 'inline-images')
    return 'inline-images'
  })
  journeys.set('drafts', async () => {
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    const draftRow = drafts.getByText('Draft: Q4 planning notes')
    await draftRow.first().waitFor({ timeout: 10000 })
    assert(true, 'drafts folder lists the seeded draft', 'draft row missing')
    await draftRow.first().click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const toValue = await content.locator('.composerField input').first().inputValue()
    assert(
      toValue.includes('team@example.com'),
      `draft To prefilled (${toValue})`,
      'draft To not prefilled'
    )
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const sent = await page.evaluate(() => window.__sent)
    const record = sent[sent.length - 1]
    assert(
      record.draftId === 'draft-1' &&
        record.inReplyTo === '<q4-plan-parent@example.com>' &&
        record.references === '<q4-plan-parent@example.com>',
      `outbox recorded draft send ${JSON.stringify(record)}`,
      'outbox has incorrect draft-send record'
    )
    // Opening the same draft again inside the delay window must not stop
    // the row from being pruned.
    await draftRow.first().click()
    await drafts.getByText('Draft: Q4 planning notes').first().waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'sent draft row pruned despite re-selection inside the window', 'row not pruned')
    // And the folder round-trip refetch confirms the mock consumed the draft.
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    await page.getByRole('complementary', { name: 'Drafts' }).waitFor({ timeout: 10000 })
    const leftover = await page
      .getByRole('complementary', { name: 'Drafts' })
      .getByText('Q4 planning notes')
      .count()
    assert(leftover === 0, 'refetched Drafts no longer shows the sent draft', 'draft reappeared after refetch')
    await snapshot(page, 'drafts')

    const uneditedSubject = 'Untouched attachment draft'
    const uneditedDraftId = await page.evaluate(async (subject) => {
      const api = window.__packagedFixtureApi ?? window.api
      const { draftId } = await api.saveDraft({
        to: 'reader@example.com',
        subject,
        body: 'No edits in this editor',
        attachments: [{ filename: 'preloaded.txt', size: 3, data: 'dHh0' }]
      })
      return draftId
    }, uneditedSubject)
    const savesBeforeOpening = await page.evaluate(() => window.__draftSaves.length)
    await page.evaluate(() => window.__pushSync({ kind: 'reset' }))
    await drafts.getByText(uneditedSubject, { exact: true }).click()
    await content.getByRole('button', { name: 'Remove preloaded.txt' }).waitFor({ timeout: 5000 })
    await page.evaluate(async (draftId) => {
      const api = window.__packagedFixtureApi ?? window.api
      await api.saveDraft({
        draftId, to: 'reader@example.com', subject: 'Remote revision', body: 'Remote text',
        attachments: [{ filename: 'preloaded.txt', size: 3, data: 'dHh0' }]
      })
    }, uneditedDraftId)
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    await drafts.getByText('Remote revision', { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await page.evaluate(() => window.__draftSaves.length)) === savesBeforeOpening + 1,
      'loading an untouched draft attachment does not save or create a conflict copy',
      'attachment prefill was mistaken for an edit and saved a stale draft copy'
    )
    await drafts.getByText('Remote revision', { exact: true }).click()
    await content.getByRole('button', { name: 'Remove preloaded.txt' }).click()
    await page.waitForFunction((draftId) => {
      const saved = window.__draftSaves.at(-1)
      return saved?.draftId === draftId && saved.attachments === undefined
    }, uneditedDraftId)
    log('pass: manually removing the attachment is an edit and autosaves')

    const draftSearch = page.getByRole('searchbox', { name: 'Search emails' })
    await draftSearch.fill('Q4 attachments')
    await draftSearch.press('Enter')
    await drafts.getByText(/results? for “Q4 attachments”/).waitFor({ timeout: 5000 })
    const remoteDraft = drafts.getByText('Draft: Q4 attachments', { exact: true }).first()
    await remoteDraft.click()
    const editor = content.getByRole('heading', { name: 'Draft', exact: true })
    await editor.waitFor({ timeout: 5000 })
    const subjectField = content.getByRole('textbox', { name: 'Subject' })
    const renamedSubject = 'Updated planning note'
    await subjectField.fill(renamedSubject)
    await page.waitForFunction((subject) => window.__draftSaves.some(
      (draft) => draft.draftId === 'draft-q4' && draft.subject === subject
    ), renamedSubject)
    await page.evaluate(() => window.__pushSync({ kind: 'reset' }))
    await remoteDraft.waitFor({ state: 'detached', timeout: 5000 })
    assert(
      (await editor.count()) === 1 && (await subjectField.inputValue()) === renamedSubject,
      'a renamed draft stays open after leaving the search results',
      'the search reset closed a draft that still exists'
    )
    await subjectField.fill('Another local rename')
    await page.waitForFunction(() =>
      window.__draftSaves.some((draft) => draft.draftId === 'draft-q4' && draft.subject === 'Another local rename')
    )
    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      await api.saveDraft({
        draftId: 'draft-q4', to: 'remote@example.com',
        subject: 'Remote edit', body: 'Edited in Gmail'
      })
    })
    await subjectField.fill('Local edit that must stay visible')
    const conflict = content.getByRole('alert').filter({ hasText: 'Draft changed in Gmail' })
    await conflict.waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: autosaving an off-list draft silently overwrote a newer Gmail edit')
    })
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByRole('alert').filter({
      hasText: 'Draft changed in Gmail', hasNotText: 'Draft not saved:'
    }).waitFor({ timeout: 5000 })
    assert(
      (await subjectField.inputValue()) === 'Local edit that must stay visible' &&
        (await page.evaluate(() => window.__draftSaves.filter((d) => d.draftId === 'draft-q4').at(-1).subject)) === 'Remote edit' &&
        (await page.evaluate(() => window.__sent.some((entry) => entry.draftId === 'draft-q4'))) === false,
      'autosave and send preserve the newer Gmail draft and leave local text visible',
      'a conflict discarded either the newer Gmail draft or the local edit'
    )
    await snapshot(page, 'drafts-search-edit-conflict')
    const leavingSubject = 'Pending edits when leaving the draft'
    await subjectField.fill(leavingSubject)
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.waitForFunction((subject) =>
      window.__draftSaves.some((d) => d.draftId !== 'draft-q4' && d.subject === subject),
      leavingSubject,
      { timeout: 5000 }
    ).catch(() => {
      throw new Error('ASSERT: navigating away silently lost the conflicting local edits')
    })
    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    await drafts.getByText(leavingSubject, { exact: true }).waitFor({ timeout: 5000 })
    log('pass: navigation preserves the pending local edit as a separate draft')
    await draftSearch.fill('Remote edit')
    await draftSearch.press('Enter')
    await drafts.getByText(/results? for “Remote edit”/).waitFor({ timeout: 5000 })
    const remoteCopy = drafts.getByText('Remote edit', { exact: true }).first()
    await remoteCopy.click()
    await editor.waitFor({ timeout: 5000 })
    await subjectField.fill('Renamed before remote deletion')
    await page.waitForFunction(() =>
      window.__draftSaves.some((d) => d.draftId === 'draft-q4' && d.subject === 'Renamed before remote deletion')
    )
    await page.evaluate(() => window.__pushSync({ kind: 'reset' }))
    await remoteCopy.waitFor({ state: 'detached', timeout: 5000 })
    await page.evaluate(() => window.__deleteDraftRemotely('draft-q4'))
    const deletedDraftEdit = 'Pending edits after Gmail deleted the draft'
    await subjectField.fill(deletedDraftEdit)
    await page.evaluate(() =>
      window.__pushSync({
        kind: 'delta', historyId: 'remote-draft-delete',
        threads: [], deletedThreadIds: ['thread-draft-q4']
      })
    )
    await editor.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: a deleted draft remains editable after a search refresh')
    })
    log('pass: search closes a draft editor after the draft is deleted externally')
    await snapshot(page, 'drafts-search-remote-delete')
    await page.waitForFunction((subject) =>
      window.__draftSaves.some((d) => d.draftId !== 'draft-q4' && d.subject === subject),
      deletedDraftEdit,
      { timeout: 5000 }
    ).catch(() => {
      throw new Error('ASSERT: remote deletion silently lost pending local edits')
    })
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    await drafts.getByText(deletedDraftEdit, { exact: true }).waitFor({ timeout: 5000 })
    log('pass: pending local edits survive remote deletion as a separate draft')
    return 'drafts'
  })
  journeys.set('delete-draft', async () => {
    // Row surface: the confirm gates the delete. Dismiss it first —
    // deleting a draft is irreversible, so refusing must be a full no-op.
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    const rowDelete = drafts.getByRole('button', { name: 'delete draft' }).first()
    await rowDelete.waitFor({ timeout: 10000 })
    assert(true, 'drafts rows offer the delete affordance', 'no delete Drafts-row button')
    const holdDialog = page.waitForEvent('dialog').then((d) => {
      const text = d.message()
      assert(
        text.includes('Delete draft') && text.includes('not even Trash keeps a copy'),
        `the confirm names the consequence (${text.slice(0, 60)}…)`,
        'the confirm does not say what a delete costs'
      )
      return d.dismiss()
    })
    await rowDelete.click()
    await holdDialog
    assert(
      (await page.evaluate(() => (window.__draftDiscards ?? []).length)) === 0,
      'dismissing the confirm deletes nothing',
      'a dismissed confirm still reached the boundary'
    )
    await drafts
      .getByText('Draft: Q4 planning notes')
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'the refused draft row stays listed', 'row vanished though the confirm was refused')

    // Accepting the confirm deletes for real: drafts.delete is not trash,
    // so the proof is the boundary record plus a folder refetch.
    const acceptRow = page.waitForEvent('dialog').then((d) => d.accept())
    await rowDelete.click()
    await acceptRow
    await drafts
      .getByText('Draft: Q4 planning notes')
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'a confirmed delete removes the draft row', 'row survived a confirmed delete')
    assert(
      (await page.evaluate(() => window.__draftDiscards?.[0]?.draftId)) === 'draft-1',
      'boundary recorded the discard (draft-1)',
      `discard record wrong or missing: ${JSON.stringify(await page.evaluate(() => window.__draftDiscards))}`
    )
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    await drafts.waitFor({ timeout: 10000 })
    assert(
      (await drafts.getByText('Q4 planning notes').count()) === 0,
      'refetched Drafts no longer shows the deleted draft',
      'deleted draft reappeared after refetch'
    )

    // Editor surface: a compose autosaves into a real draft row, then the
    // row opens into the editor and that editor deletes its own draft.
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('brook@example.com')
    await content.locator('.composerField input').nth(1).fill('Deleted mid-edit')
    await content.locator('.body-editor').fill('A draft worth deleting.')
    await page.waitForFunction(() => (window.__draftSaves ?? []).length >= 1, undefined, {
      timeout: 10000
    })
    assert(true, 'compose autosaved into a real draft', 'no autosave save was recorded')
    // Close the compose through a folder switch while the Drafts view is
    // NOT behind it — selecting Drafts again would hit the same-folder
    // guard that skips both the close and the refetch.
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    await drafts.waitFor({ timeout: 10000 })
    await drafts
      .getByText('Deleted mid-edit', { exact: true })
      .first()
      .click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const editorId = await page.evaluate(() => window.__draftSaves?.at(-1)?.draftId)
    const unsavedSubject = 'Confirmed delete discards my pending edit'
    const pauseTime = await page.evaluate(() => Date.now() + 5000)
    await page.clock.pauseAt(pauseTime)
    await content.getByRole('textbox', { name: 'Subject' }).fill(unsavedSubject)
    const acceptEditor = page.waitForEvent('dialog').then((d) => d.accept())
    // Scoped to the pane: the live row behind this editor also renders a
    // "delete draft" button in the list.
    await content.getByRole('button', { name: 'delete draft' }).click()
    await acceptEditor
    await content
      .getByRole('heading', { name: 'Draft', exact: true })
      .waitFor({ state: 'detached', timeout: 10000 })
    await page.clock.resume()
    assert(true, 'confirming the editor delete closes the editor cleanly', 'editor stayed open after its own delete')
    await drafts
      .getByText('Deleted mid-edit', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'the deleted draft row left the Drafts list', 'row stayed after the editor delete')
    const lastDiscard = await page.evaluate(() => window.__draftDiscards?.at(-1)?.draftId)
    assert(
      lastDiscard === editorId && editorId !== 'draft-1',
      `boundary recorded the editor discard (${lastDiscard})`,
      `editor discard record wrong or the wrong draft died: last=${lastDiscard} editor=${editorId}`
    )
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    await drafts.getByText('Draft: Q4 attachments', { exact: true }).first().waitFor({ timeout: 5000 })
    const pendingWrites = await page.evaluate((subject) =>
      window.__draftSaves.filter((draft) => draft.subject === subject), unsavedSubject)
    assert(
      !pendingWrites.some((draft) => !draft.copyOnConflict),
      'the edit was still pending when delete closed the editor',
      'an ordinary autosave committed the edit before delete could exercise recovery'
    )
    assert(
      pendingWrites.length === 0 && (await drafts.getByText(unsavedSubject, { exact: true }).count()) === 0,
      'confirming delete discards pending edits without a recovery copy',
      'closing a deliberately deleted draft recovered the pending edits as a new draft'
    )
    await snapshot(page, 'delete-draft')
    return 'delete-draft'
  })
  journeys.set('draft-autosave', async () => {
    // Fresh compose: type, let the boundary record the autosave, then close
    // the pane without Send or Cancel — the accidental-close path.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('brook@example.com')
    await content.locator('.composerField input').nth(1).fill('Autosaved while typing')
    await content.locator('.body-editor').fill('Half a thought saved before anything was sent.')
    await page.waitForFunction(() => (window.__draftSaves ?? []).length >= 1, undefined, { timeout: 10000 })
    assert(true, 'compose autosave recorded by the boundary', 'no autosave save was recorded')
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    assert(
      (await page.evaluate(() => (window.__sent ?? []).length)) === 0,
      'closing the pane sent nothing',
      'closing compose reached the outbox'
    )
    // The restore surface is the Drafts folder: the autosaved compose is a
    // real draft row whose editor opens prefilled with the typed content.
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    const autosavedRow = drafts.getByText('Autosaved while typing', { exact: true })
    await autosavedRow.first().waitFor({ timeout: 10000 })
    assert(true, 'autosaved compose appears in the Drafts folder', 'autosaved draft row missing')
    const firstSaveDraftId = await page.evaluate(() => window.__draftSaves[0]?.draftId)
    await autosavedRow.first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const restoredTo = await content.locator('.composerField input').first().inputValue()
    const restoredBody = await bodyTextOf(content.locator('.body-editor'))
    assert(
      restoredTo.includes('brook@example.com') &&
        restoredBody.includes('Half a thought saved before anything was sent.'),
      `editor reopens the autosaved content (${restoredTo})`,
      'autosaved content lost across the close/reopen round trip'
    )
    // Send consumes the autosaved draft through the atomic send-draft pair.
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const sentRecords = await page.evaluate(() => window.__sent)
    const firstSend = sentRecords[sentRecords.length - 1]
    assert(
      sentRecords.length === 1 &&
        firstSend.draftId === firstSaveDraftId &&
        firstSend.to === 'brook@example.com' &&
        firstSend.body.includes('Half a thought saved before anything was sent.'),
      `outbox record consumed the autosaved draft ${JSON.stringify(firstSend)}`,
      'send did not consume the autosaved draft'
    )
    // Cancel still discards: a compose that got past its first autosave is
    // deleted from the boundary, not kept behind the message.
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('discard-me@example.com')
    await page.waitForFunction(() => (window.__draftSaves ?? []).length >= 2, undefined, { timeout: 10000 })
    assert(true, 'second compose autosaved before cancel', 'cancel case had no autosave to discard')
    await content.getByRole('button', { name: 'Cancel', exact: true }).click()
    await content.getByText('Nothing open yet :P').waitFor({ timeout: 10000 })
    const discards = await page.evaluate(() => window.__draftDiscards)
    assert(
      discards.length === 1 && typeof discards[0].draftId === 'string' && discards[0].draftId !== firstSaveDraftId,
      `cancel deletes the autosaved draft ${JSON.stringify(discards)}`,
      'cancel did not discard the autosaved draft'
    )
    // Editing an existing draft autosaves on its own draft id and keeps the
    // stored threading headers intact for the send after the round trip.
    await drafts.getByText('Draft: Q4 planning notes').first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    await typeAtEnd(content.locator('.body-editor'), '\nAdding the Q4 agenda line.')
    await page.waitForFunction(
      () => (window.__draftSaves ?? []).length >= 3 && window.__draftSaves[2]?.draftId === 'draft-1',
      undefined,
      { timeout: 10000 }
    )
    assert(true, 'draft edit autosaved on the stored draft id', 'draft edit did not autosave')
    await drafts.getByText('Draft: Q4 attachments', { exact: true }).first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    await drafts.getByText('Draft: Q4 planning notes', { exact: true }).first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    assert(
      (await bodyTextOf(content.locator('.body-editor'))).includes('Adding the Q4 agenda line.'),
      'reopening from the still-loaded draft row reads the current Gmail message',
      'the still-loaded row opened an older draft message'
    )
    await page.getByRole('button', { name: 'Inbox' }).click()
    await inbox.waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Draft: Q4 planning notes').first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const reopenedBody = await bodyTextOf(content.locator('.body-editor'))
    assert(
      reopenedBody.includes('Adding the Q4 agenda line.'),
      `draft edit survived the close/reopen round trip (${reopenedBody.slice(0, 120)})`,
      'edited draft content lost'
    )
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const draftSend = (await page.evaluate(() => window.__sent))[1]
    assert(
      draftSend.draftId === 'draft-1' &&
        draftSend.inReplyTo === '<q4-plan-parent@example.com>' &&
        draftSend.body.includes('Adding the Q4 agenda line.'),
      `outbox record carried the edited draft send ${JSON.stringify(draftSend)}`,
      'edited draft send lost content or threading headers'
    )
    await snapshot(page, 'draft-autosave')
    return 'draft-autosave'
  })
  journeys.set('delete-to-trash', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'delete', exact: true }).click()
    // Row leaves the inbox list and the detail pane closes in one step.
    await inbox
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    assert((await inbox.getByText('Launch checklist', { exact: true }).count()) === 0, 'deleted row left the inbox list', 'row still listed')
    await content.getByText('Nothing open yet :P').waitFor({ timeout: 10000 })
    assert(true, 'detail pane closed after delete', 'detail pane stayed open')
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-launch' &&
        (mods[0].addLabelIds ?? []).includes('TRASH') &&
        (mods[0].removeLabelIds ?? []).includes('INBOX'),
      `label mods recorded ${JSON.stringify(mods)}`,
      'modifyLabels side effect not recorded'
    )
    // The thread now carries the TRASH label, so the Trash folder refetch
    // lists it and the Inbox refetch does not: the mutation is label state,
    // not the client filter.
    await page.getByRole('button', { name: 'Drafts' }).click()
    await page.getByRole('complementary', { name: 'Drafts' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Trash' }).click()
    const trash = page.getByRole('complementary', { name: 'Trash' })
    await trash.waitFor({ timeout: 10000 })
    await trash.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'Trash folder lists the deleted thread', 'thread missing from Trash refetch')
    const untouchable = await trash.getByText('Q3 budget draft', { exact: true }).count()
    assert(untouchable === 0, 'Trash folder still hides untouched mail', 'Trash refetch shows other mail')
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    const backInInbox = await page
      .getByRole('complementary', { name: 'Inbox' })
      .getByText('Launch checklist', { exact: true })
      .count()
    assert(backInInbox === 0, 'refetched inbox no longer shows the deleted thread', 'thread reappeared after refetch')
    await snapshot(page, 'delete-to-trash')
    return 'delete-to-trash'
  })
  journeys.set('archive', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByText('Deploy window', { exact: true }).first().click()
    // The Email content region exists before any selection; the detail
    // heading is the real gate that the row click landed.
    await page.getByRole('heading', { name: 'Deploy window' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'archive', exact: true }).click()
    // Both rows of the thread are removed together by App's thread filter,
    // so the exact subject match leaving the list is the archive proof.
    await inbox
      .getByText('Deploy window', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    const retired = await inbox.getByText('Deploy window', { exact: true }).count()
    assert(retired === 0, 'Deploy window rows left the inbox list', 'thread rows still listed')
    await content.getByText('Nothing open yet :P').waitFor({ timeout: 10000 })
    assert(true, 'detail pane closed after archive', 'detail pane stayed open')
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-deploy' &&
        (mods[0].removeLabelIds ?? []).includes('INBOX'),
      `label mods recorded ${JSON.stringify(mods)}`,
      'modifyLabels side effect not recorded'
    )
    // Persistence: a folder round-trip refetches the list through listFolder,
    // so the rows staying gone proves the mock's label state, not the client filter.
    await page.getByRole('button', { name: 'Drafts' }).click()
    await page.getByRole('complementary', { name: 'Drafts' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    const afterRefetch = await page
      .getByRole('complementary', { name: 'Inbox' })
      .getByText('Deploy window', { exact: true })
      .count()
    assert(afterRefetch === 0, 'refetched inbox still hides the archived thread', 'archived thread reappeared after refetch')
    await page.getByRole('complementary', { name: 'Inbox' }).getByText('Launch checklist').first().waitFor({ timeout: 10000 })
    assert(true, 'refetched inbox still lists untouched mail', 'inbox refetch dropped other mail')
    await snapshot(page, 'archive')
    return 'archive'
  })
  journeys.set('mark-read', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    // Seeded mail arrives read, so every row starts with "mark unread".
    const row = inbox.locator('li', { hasText: 'Launch checklist' }).first()
    const toggle = row.getByRole('button', { name: 'mark unread', exact: true })
    await toggle.waitFor({ timeout: 10000 })
    await toggle.click()
    // The local page flips immediately; the real proof is the boundary
    // mutation, so assert both.
    await row.getByRole('button', { name: 'mark read', exact: true }).waitFor({ timeout: 10000 })
    assert((await page.locator('li.unread').count()) === 1, 'unread row renders bold-marked class', 'unread row class missing')
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-launch' &&
        (mods[0].addLabelIds ?? []).includes('UNREAD'),
      `label mods recorded ${JSON.stringify(mods)}`,
      'mark-unread modifyLabels side effect not recorded'
    )
    // Folder round-trip refetches through listFolder, so the row staying
    // unread proves the mock's label state, not the client filter.
    await page.getByRole('button', { name: 'Drafts' }).click()
    await page.getByRole('complementary', { name: 'Drafts' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Inbox' }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    const refetched = inbox.locator('li.unread', { hasText: 'Launch checklist' })
    await refetched.waitFor({ timeout: 10000 })
    assert((await refetched.count()) === 1, 'refetched inbox still shows the unread row', 'unread state lost after refetch')
    // Opening the unread email auto-marks the thread read: the boundary
    // gets the UNREAD removal and the row drops back to read rendering.
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await content.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    const readMods = await page.evaluate(() => window.__mods)
    assert(
      readMods.length === 2 &&
        readMods[1].kind === 'thread' &&
        readMods[1].id === 'thread-launch' &&
        (readMods[1].removeLabelIds ?? []).includes('UNREAD'),
      `auto-read mod recorded ${JSON.stringify(readMods)}`,
      'opening an unread email did not mark it read'
    )
    await inbox.locator('li', { hasText: 'Launch checklist' }).first().getByRole('button', { name: 'mark unread', exact: true }).waitFor({ timeout: 10000 })
    assert((await page.locator('li.unread').count()) === 0, 'row shows read after auto-read', 'row stayed unread after open')
    // The detail toggle flips the thread back to unread from the detail view.
    await content.getByRole('button', { name: 'mark as unread', exact: true }).click()
    await content.getByRole('button', { name: 'mark as read', exact: true }).waitFor({ timeout: 10000 })
    assert((await page.locator('li.unread').count()) === 1, 'detail toggle re-marks the thread unread', 'detail toggle did not flip row state')
    await snapshot(page, 'mark-read')
    return 'mark-read'
  })
  journeys.set('starred', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const row = inbox.locator('li', { hasText: 'Launch checklist' }).first()
    const star = row.getByRole('button', { name: 'Star', exact: true })
    await star.waitFor({ timeout: 10000 })
    await star.click()
    // The row flips to the Unstar affordance immediately; the boundary proof is below.
    await row.getByRole('button', { name: 'Unstar', exact: true }).waitFor({ timeout: 10000 })
    assert((await row.getByRole('button', { name: 'Unstar', exact: true }).getAttribute('aria-pressed')) === 'true', 'row star button pressed after starring', 'row star button not pressed after starring')
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-launch' &&
        (mods[0].addLabelIds ?? []).includes('STARRED'),
      `label mods recorded ${JSON.stringify(mods)}`,
      'star modifyLabels side effect not recorded'
    )
    // The Starred view lists the mail because the mock re-derived the page
    // from label state, not from a client-side filter.
    await page.getByRole('button', { name: 'Starred' }).click()
    const starred = page.getByRole('complementary', { name: 'Starred' })
    await starred.getByText('Launch checklist').first().waitFor({ timeout: 10000 })
    assert(true, 'Starred view lists the starred mail', 'starred mail missing from the Starred view')
    // Unstarring from the Starred view removes the row the way archive
    // leaves the Inbox list, and the boundary gets the removal.
    await starred.locator('li', { hasText: 'Launch checklist' }).first().getByRole('button', { name: 'Unstar', exact: true }).click()
    await starred.locator('li', { hasText: 'Launch checklist' }).first().waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'unstar from the Starred view removes the row', 'unstarred row stayed in the Starred view')
    const unstarMods = await page.evaluate(() => window.__mods)
    assert(
      unstarMods.length === 2 && (unstarMods[1].removeLabelIds ?? []).includes('STARRED'),
      `unstar mod recorded ${JSON.stringify(unstarMods)}`,
      'unstar modifyLabels side effect not recorded'
    )
    // The detail view offers the same toggle as text; reload reseeds the
    // mock, so this walks the Inbox → detail path from clean state.
    await page.reload()
    const refetchedInbox = page.getByRole('complementary', { name: 'Inbox' })
    await refetchedInbox.waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().click()
    const content = page.getByRole('region', { name: 'Email content' })
    await content.getByRole('button', { name: 'not starred' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'not starred' }).click()
    await content.getByRole('button', { name: 'starred' }).waitFor({ timeout: 10000 })
    assert(true, 'detail star toggle flips to starred', 'detail star toggle did not flip')
    const detailMods = await page.evaluate(() => window.__mods)
    assert(
      detailMods.length === 1 && (detailMods[0].addLabelIds ?? []).includes('STARRED'),
      `detail star mod recorded ${JSON.stringify(detailMods)}`,
      'detail star modifyLabels side effect not recorded'
    )
    await refetchedInbox.locator('li', { hasText: 'Launch checklist' }).first().getByRole('button', { name: 'Unstar', exact: true }).waitFor({ timeout: 10000 })
    await snapshot(page, 'starred')
    return 'starred'
  })
  journeys.set('all-mail', async () => {
    const content = page.getByRole('region', { name: 'Email content' })
    // Archive one thread from its Inbox detail first: the archive button
    // lives in Inbox details only, and All Mail exists to surface rows the
    // Inbox has dropped.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    await page.getByText('Deploy window', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Deploy window' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'archive', exact: true }).click()
    await inbox
      .getByText('Deploy window', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-deploy' &&
        (mods[0].removeLabelIds ?? []).includes('INBOX'),
      `archive mod recorded ${JSON.stringify(mods)}`,
      'archive modifyLabels side effect not recorded'
    )
    // The All Mail rail entry lists every thread regardless of label. The
    // archived row surviving a fresh refetch is the label-state proof, not
    // a client filter, and mail still carrying INBOX stays listed.
    await page.getByRole('button', { name: 'All Mail' }).click()
    const allMail = page.getByRole('complementary', { name: 'All Mail' })
    await allMail.waitFor({ timeout: 10000 })
    await allMail.getByText('Deploy window', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'archived thread appears in All Mail', 'archived thread missing from All Mail')
    for (const subject of ['Launch checklist', 'Q3 budget draft']) {
      await allMail.getByText(subject, { exact: true }).first().waitFor({ timeout: 10000 })
    }
    assert(true, 'mail still carrying its INBOX label stays listed in All Mail', 'inbox rows missing from All Mail')
    // Every message is browsable: selecting from All Mail opens the detail.
    await allMail.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    assert(true, 'selecting from All Mail opens the detail', 'detail did not open from All Mail')
    // Inbox round trip: the label filter keeps the archived row gone for good.
    await page.getByRole('button', { name: 'Inbox' }).click()
    await inbox.waitFor({ timeout: 10000 })
    assert(
      (await inbox.getByText('Deploy window', { exact: true }).count()) === 0,
      'refetched Inbox still hides the archived thread',
      'archived thread reappeared in Inbox'
    )
    await snapshot(page, 'all-mail')

    const parent = '<deploy-1@example.com>'
    const subject = 'Re: Deploy window'
    const saved = await page.evaluate(
      ({ parent, subject }) => (window.__packagedFixtureApi ?? window.api).saveDraft({
        threadId: 'thread-deploy',
        to: 'alan@example.com',
        subject,
        body: 'Thursday is confirmed.',
        inReplyTo: parent,
        references: parent
      }),
      { parent, subject }
    )
    await page.getByRole('button', { name: 'All Mail' }).click()
    const replyThread = allMail.getByText('Deploy window', { exact: true }).first()
    await replyThread.click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    const result = content.getByText(/^(Message sent\.|Sent as a new message;)/)
    await result.waitFor({ timeout: 10000 })
    await snapshot(page, 'all-mail-reply-draft-send')
    const [record] = await page.evaluate(() => window.__sent)
    assert(
      record?.draftId === saved.draftId &&
        record.expectedMessageId === saved.messageId &&
        record.threadId === 'thread-deploy' &&
        record.inReplyTo === parent &&
        record.references === parent,
      `outbox recorded the original reply draft send ${JSON.stringify(record)}`,
      `All Mail did not send the existing reply draft: ${JSON.stringify(record)}`
    )
    await replyThread.click()
    await content.getByText('2 messages in conversation', { exact: true }).waitFor({ timeout: 10000 })
    assert(true, 'All Mail still opens the conversation after sending', 'conversation was removed')
    await snapshot(page, 'all-mail-reply-draft-conversation')
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.getByText('Draft: Q4 planning notes', { exact: true }).waitFor({ timeout: 10000 })
    assert(
      (await drafts.getByText(subject, { exact: true }).count()) === 0,
      'refetched Drafts no longer lists the sent reply draft',
      'the original reply draft was left behind'
    )
    await snapshot(page, 'all-mail-reply-draft-cleanup')
    return 'all-mail'
  })
  journeys.set('reply-all', async () => {
    // Standup notes carries author + one extra To recipient + one Cc
    // recipient; the own address sits in To and must drop out. The split
    // follows the original headers: the author plus the previous To stay in
    // To and the previous Cc moves into its own Cc field.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByText('Standup notes', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Standup notes' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'reply all', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    const toValue = await page.locator('.composerField input').first().inputValue()
    assert(
      toValue.includes('ada@example.com') &&
        toValue.includes('ben@example.com') &&
        !toValue.includes('nia@example.com') &&
        !toValue.includes('me@example.com'),
      `reply-all To keeps author + previous To minus self (${toValue})`,
      'reply-all To split wrong'
    )
    const ccValue = await page.locator('.composer').getByLabel('Cc', { exact: true }).inputValue()
    assert(
      ccValue === 'Nia Chambers <nia@example.com>',
      `reply-all Cc carries the previous Cc (${ccValue})`,
      'reply-all Cc wrong'
    )
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    // Reply (single) keeps its old one-address To from the same view.
    await content.getByRole('button', { name: 'reply', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    const replyTo = await page.locator('.composerField input').first().inputValue()
    assert(
      replyTo.includes('ada@example.com') &&
        !replyTo.includes('ben@example.com') &&
        !replyTo.includes('nia@example.com') &&
        !replyTo.includes('me@example.com'),
      `reply single To stays one address (${replyTo})`,
      'reply single To changed'
    )
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    // Send the reply-all and read the sent entry back from the outbox.
    await content.getByRole('button', { name: 'reply all', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    await typeAtStart(page.locator('.body-editor'), 'Agenda updated, see notes.\n\n')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('status').getByText('Message sent.').waitFor({ timeout: 10000 })
    const sent = await page.evaluate(() => window.__sent)
    const record = sent[sent.length - 1]
    assert(
      sent.length === 1 &&
        record.to.includes('ada@example.com') &&
        record.to.includes('ben@example.com') &&
        !record.to.includes('nia@example.com') &&
        !record.to.includes('me@example.com') &&
        record.cc === 'Nia Chambers <nia@example.com>' &&
        record.subject === 'Re: Standup notes' &&
        record.threadId === 'thread-standup' &&
        record.inReplyTo === '<standup@example.com>',
      `outbox recorded reply-all ${JSON.stringify(record)}`,
      'outbox missing or wrong reply-all record'
    )
    await snapshot(page, 'reply-all')
    return 'reply-all'
  })
  journeys.set('cc-bcc', async () => {
    // The Cc/Bcc composer surface: reveal links, the send payload, and the
    // draft round trip. Reply-all first pins that the reply payload never
    // grows a Bcc the user did not type.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByText('Standup notes', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Standup notes' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'reply all', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    assert(
      (await page.locator('.composer').getByLabel('Bcc', { exact: true }).count()) === 0,
      'reply-all leaves the Bcc field hidden (never auto-added)',
      'reply-all auto-added a Bcc field'
    )
    assert(
      (await page.locator('.composer').getByLabel('Cc', { exact: true }).count()) === 1,
      'reply-all opens the Cc field it prefilled',
      'reply-all Cc field not open'
    )
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Fresh compose: only To and Subject exist until the links reveal Cc and
    // Bcc, and a revealed link disappears, so reveal is idempotent.
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    assert(
      (await content.locator('.composerField input').count()) === 2,
      'fresh compose shows only To and Subject',
      'fresh compose did not keep Cc/Bcc collapsed'
    )
    await content.getByRole('button', { name: 'Cc', exact: true }).click()
    assert(
      (await content.locator('.composer').getByRole('button', { name: 'Cc', exact: true }).count()) ===
        0,
      'the Cc link hides once the Cc field is open',
      'Cc link stayed after reveal'
    )
    await content.locator('.composer').getByLabel('Cc', { exact: true }).fill('cecil@example.com')
    assert(
      (await content.locator('.composerField input').count()) === 3,
      'typing Cc keeps the field open (no second reveal)',
      'Cc field not stable while typing'
    )
    await content.getByRole('button', { name: 'Bcc', exact: true }).click()
    await content.locator('.composer').getByLabel('Bcc', { exact: true }).fill('secret@example.com')
    await content.locator('.composer').getByLabel('To').fill('ada@example.com')
    await content.locator('.composer').getByLabel('Subject').fill('Carbon note for the record')
    await content.locator('.body-editor').fill('Carbon recipients ride the send.')
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const fresh = (await page.evaluate(() => window.__sent)).slice(-1)[0]
    assert(
      fresh.to === 'ada@example.com' &&
        fresh.cc === 'cecil@example.com' &&
        fresh.bcc === 'secret@example.com' &&
        fresh.subject === 'Carbon note for the record',
      `outbox recorded the carbon lists ${JSON.stringify(fresh)}`,
      'fresh send lost cc/bcc'
    )
    await content.getByRole('button', { name: 'Close', exact: true }).click()

    // A Gmail draft carrying Cc restores it, a typed Bcc autosaves through
    // the same payload as the rest of the composer state and survives
    // close/reopen, and the draft send carries all three lists.
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Draft: Q4 planning notes').first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const draftCc = await content.locator('.composer').getByLabel('Cc', { exact: true }).inputValue()
    assert(
      draftCc === 'Grace Hopper <grace@example.com>',
      `draft Cc restored from the Gmail draft headers (${draftCc})`,
      'Gmail draft Cc not restored'
    )
    await content.locator('.composer').getByRole('button', { name: 'Bcc', exact: true }).click()
    await content.locator('.composer').getByLabel('Bcc', { exact: true }).fill('secret@example.com')
    await page.waitForFunction(
      () =>
        (window.__draftSaves ?? []).some(
          (s) => s.draftId === 'draft-1' && `${s.bcc ?? ''}`.includes('secret@example.com')
        ),
      undefined,
      { timeout: 10000 }
    )
    assert(true, 'bcc autosaved through the shared draft payload', 'bcc never reached the draft save')
    // Switch folders to close the draft editor: the Drafts list has no
    // thread rows to click, so the away step is the rail's Inbox button.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await content
      .getByRole('heading', { name: 'Draft', exact: true })
      .waitFor({ state: 'detached', timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Draft: Q4 planning notes').first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const restoredCc = await content.locator('.composer').getByLabel('Cc', { exact: true }).inputValue()
    const restoredBcc = await content.locator('.composer').getByLabel('Bcc', { exact: true }).inputValue()
    assert(
      restoredCc.includes('grace@example.com') && restoredBcc.includes('secret@example.com'),
      `carbon lists survived close/reopen (cc: ${restoredCc}, bcc: ${restoredBcc})`,
      'carbon lists lost across the draft round trip'
    )
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const draftSend = (await page.evaluate(() => window.__sent)).slice(-1)[0]
    assert(
      draftSend.draftId === 'draft-1' &&
        draftSend.cc === 'Grace Hopper <grace@example.com>' &&
        draftSend.bcc === 'secret@example.com',
      `outbox recorded the draft carbon lists ${JSON.stringify(draftSend)}`,
      'draft send lost cc/bcc'
    )
    await snapshot(page, 'cc-bcc')
    return 'cc-bcc'
  })
  journeys.set('spam', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    // Report spam from the detail pane: the open inbox thread is removed
    // from the Inbox list and the detail pane closes in one step.
    await page.getByText('Q3 budget draft', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Q3 budget draft' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'report spam', exact: true }).click()
    await inbox
      .getByText('Q3 budget draft', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    assert(
      (await inbox.getByText('Q3 budget draft', { exact: true }).count()) === 0,
      'reported row left the inbox list',
      'reported row still listed in the inbox'
    )
    await content.getByText('Nothing open yet :P').waitFor({ timeout: 10000 })
    assert(true, 'detail pane closed after report spam', 'detail pane stayed open')
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-budget' &&
        (mods[0].addLabelIds ?? []).includes('SPAM') &&
        (mods[0].removeLabelIds ?? []).includes('INBOX'),
      `report spam mod recorded ${JSON.stringify(mods)}`,
      'report-spam modifyLabels side effect not recorded'
    )
    // The Spam view lists the reported thread (the mock re-derived the page
    // from label state) next to the seeded spam mail.
    await page.getByRole('button', { name: 'Spam' }).click()
    const spam = page.getByRole('complementary', { name: 'Spam' })
    await spam.waitFor({ timeout: 10000 })
    await spam.getByText('Q3 budget draft', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'reported thread appears in the Spam view', 'thread missing from the Spam refetch')
    await spam.getByText('You won a free cruise', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'seeded spam mail is listed in the Spam view', 'seeded spam row missing')
    // All Mail still hides spam and lists the untouched mail: wait for the
    // refetch to land with the inbox thread, then assert the partition.
    await page.getByRole('button', { name: 'All Mail' }).click()
    const allMail = page.getByRole('complementary', { name: 'All Mail' })
    await allMail.waitFor({ timeout: 10000 })
    await allMail.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'All Mail lists the untouched inbox mail', 'inbox mail missing from All Mail')
    assert(
      (await allMail.getByText('You won a free cruise', { exact: true }).count()) === 0,
      'All Mail still hides spam mail',
      'spam mail leaked into All Mail'
    )
    // Not spam from the detail view restores the thread to the Inbox: the
    // row clears from the Spam list and the boundary gets the reverse pair.
    await page.getByRole('button', { name: 'Spam' }).click()
    await spam.waitFor({ timeout: 10000 })
    await spam.getByText('Q3 budget draft', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Q3 budget draft' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'not spam', exact: true }).click()
    await spam
      .getByText('Q3 budget draft', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    const unspamMods = await page.evaluate(() => window.__mods)
    assert(
      unspamMods.length === 2 &&
        unspamMods[1].kind === 'thread' &&
        unspamMods[1].id === 'thread-budget' &&
        (unspamMods[1].addLabelIds ?? []).includes('INBOX') &&
        (unspamMods[1].removeLabelIds ?? []).includes('SPAM'),
      `not-spam mod recorded ${JSON.stringify(unspamMods)}`,
      'not-spam modifyLabels side effect not recorded'
    )
    await page.getByRole('button', { name: 'Inbox' }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Q3 budget draft', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'not spam restored the thread to the Inbox', 'thread missing from the Inbox refetch')
    await page.getByRole('button', { name: 'Spam' }).click()
    await spam.waitFor({ timeout: 10000 })
    const cruiseLi = spam.locator('li', { hasText: 'You won a free cruise' }).first()
    await cruiseLi.getByRole('button', { name: 'not spam', exact: true }).click()
    await cruiseLi.waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'row-level not spam removed the row from the Spam list', 'row stayed listed')
    const rowMods = await page.evaluate(() => window.__mods)
    assert(
      rowMods.length === 3 &&
        rowMods[2].kind === 'thread' &&
        rowMods[2].id === 'thread-spam-1' &&
        (rowMods[2].addLabelIds ?? []).includes('INBOX') &&
        (rowMods[2].removeLabelIds ?? []).includes('SPAM'),
      `row not-spam mod recorded ${JSON.stringify(rowMods)}`,
      'row-level not-spam modifyLabels side effect not recorded'
    )
    await page.getByRole('button', { name: 'Inbox' }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('You won a free cruise', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'row-level not spam restored the seeded mail to the Inbox', 'spam mail missing from the Inbox after restore')
    await snapshot(page, 'spam')
    return 'spam'
  })
  journeys.set('snooze', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    // The emulation round changed this pin: the detail pane does offer a
    // snooze action now, through the 'Snoozed by Mailsy' user label — the
    // SNOOZED pseudo-label write is still forbidden, so the affordance is
    // the preset trigger and the write shape is a label pair, not SNOOZED.
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    assert(
      (await content.getByRole('button', { name: 'snooze', exact: true }).count()) === 1,
      'detail pane offers the snooze affordance (parking writes ride the user label)',
      'detail pane is missing the snooze affordance'
    )
    // The Snoozed view is the in:snoozed query: the mock re-derives the page
    // from the parking marker, and both seeded parked threads are listed.
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    const snoozed = page.getByRole('complementary', { name: 'Snoozed' })
    await snoozed.waitFor({ timeout: 10000 })
    await snoozed.getByText('Vendor pricing follow-up', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'seeded parked mail is listed in the Snoozed view', 'seeded snoozed row missing')
    await snoozed.getByText('Newsletter backlog cleanup', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'second seeded parked thread is listed in the Snoozed view', 'second seeded snoozed row missing')
    // All Mail keeps parked mail visible: the Gmail API's no-label default
    // excludes only SPAM and TRASH, so parking is not an All Mail removal.
    await page.getByRole('button', { name: 'All Mail', exact: true }).click()
    const allMail = page.getByRole('complementary', { name: 'All Mail' })
    await allMail.waitFor({ timeout: 10000 })
    await allMail.getByText('Vendor pricing follow-up', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'All Mail still lists parked mail', 'parked mail missing from All Mail')
    // Unsnooze from the detail view returns the mail to the Inbox: the row
    // clears from the Snoozed list and the boundary gets an INBOX add only —
    // SNOOZED is not a writable label, and Gmail ends the parking state on
    // the move-to-Inbox itself.
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    await snoozed.waitFor({ timeout: 10000 })
    await snoozed.getByText('Vendor pricing follow-up', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Vendor pricing follow-up' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'unsnooze', exact: true }).click()
    await snoozed
      .getByText('Vendor pricing follow-up', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-snoozed-1' &&
        mods[0].addLabelIds.length === 1 &&
        mods[0].addLabelIds[0] === 'INBOX' &&
        mods[0].removeLabelIds === undefined,
      `unsnooze mod recorded ${JSON.stringify(mods)}`,
      'unsnooze modifyLabels side effect not recorded'
    )
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Vendor pricing follow-up', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'unsnooze restored the thread to the Inbox', 'thread missing from the Inbox refetch')
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    await snoozed.waitFor({ timeout: 10000 })
    // Row-level unsnooze on the second seeded parked row mirrors the Spam
    // view's row-level not spam.
    const parkedLi = snoozed.locator('li', { hasText: 'Newsletter backlog cleanup' }).first()
    await parkedLi.getByRole('button', { name: 'unsnooze', exact: true }).click()
    await parkedLi.waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'row-level unsnooze removed the row from the Snoozed list', 'row stayed listed')
    const rowMods = await page.evaluate(() => window.__mods)
    assert(
      rowMods.length === 2 &&
        rowMods[1].kind === 'thread' &&
        rowMods[1].id === 'thread-snoozed-2' &&
        rowMods[1].addLabelIds.length === 1 &&
        rowMods[1].addLabelIds[0] === 'INBOX',
      `row unsnooze mod recorded ${JSON.stringify(rowMods)}`,
      'row-level unsnooze modifyLabels side effect not recorded'
    )
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Newsletter backlog cleanup', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'row-level unsnooze restored the second thread to the Inbox', 'parked mail missing from the Inbox after restore')
    await snapshot(page, 'snooze')
    return 'snooze'
  })
  journeys.set('snooze-wake', async () => {
    for (const scenario of [
      'selected',
      'other',
      'lookup-error',
      'lookup-not-found',
      'still-parked'
    ].filter((value) => !arg('wake-case') || value === arg('wake-case'))) {
      const selected = scenario === 'other' ? 'Vendor pricing follow-up' : 'Launch checklist'
      await page.reload({ waitUntil: 'domcontentloaded' })
      const inbox = page.getByRole('complementary', { name: 'Inbox' })
      const content = page.getByRole('region', { name: 'Email content' })
      if (scenario === 'selected') {
        await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
        const parked = page.getByRole('complementary', { name: 'Snoozed' })
        for (const subject of ['Vendor pricing follow-up', 'Newsletter backlog cleanup']) {
          const row = parked.locator('li', { hasText: subject }).first()
          await row.getByRole('button', { name: 'unsnooze', exact: true }).click()
          await row.waitFor({ state: 'detached' })
        }
        await page.getByRole('button', { name: 'Inbox', exact: true }).click()
      }
      await inbox.getByText('Launch checklist', { exact: true }).click()
      await content.getByRole('button', { name: 'snooze', exact: true }).click()
      await content.getByRole('button', { name: 'Tomorrow', exact: true }).click()
      await content.getByText('Nothing open yet :P').waitFor()
      await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
      const snoozed = page.getByRole('complementary', { name: 'Snoozed' })
      const waking = snoozed.getByText('Launch checklist', { exact: true })
      await waking.waitFor()
      await snoozed.getByText(selected, { exact: true }).click()
      await content.getByRole('heading', { name: selected, exact: true }).waitFor()
      if (
        scenario === 'lookup-error' ||
        scenario === 'lookup-not-found' ||
        scenario === 'still-parked'
      ) {
        await page.evaluate((scenario) => {
          const getThread = (window.__packagedFixtureApi ?? window.api).getThread
          let fail = true
          ;(window.__packagedFixtureApi ?? window.api).getThread = async (id) => {
            if (scenario !== 'still-parked' && fail) {
              fail = false
              throw new Error(
                scenario === 'lookup-not-found'
                  ? '404 Requested entity was not found'
                  : 'Wake membership unavailable'
              )
            }
            if (scenario === 'still-parked') {
              const thread = await getThread(id)
              return {
                ...thread,
                labelIds: [...thread.labelIds, 'INBOX'],
                messages: [
                  ...thread.messages,
                  { ...thread.messages[0], id: 'new-inbox-reply', labelIds: ['INBOX'] }
                ]
              }
            }
            return getThread(id)
          }
        }, scenario)
      }
      const freshTitle = ['lookup-error', 'lookup-not-found', 'still-parked'].includes(scenario)
        ? 'Fresh parked newsletter'
        : 'Newsletter backlog cleanup'
      await page.evaluate(
        ({ scenario, freshTitle }) => {
          window.__snoozeWakePages = []
          const listFolder = (window.__packagedFixtureApi ?? window.api).listFolder
          ;(window.__packagedFixtureApi ?? window.api).listFolder = async (options) => {
            const result = await listFolder(options)
            if (options.folder === 'snoozed') {
              result.threads = result.threads.map((row) =>
                row.id === 'thread-snoozed-2' ? { ...row, subject: freshTitle } : row
              )
              if (scenario === 'still-parked')
                result.threads = result.threads.filter((row) => row.id !== 'thread-launch')
            }
            if (options.folder === 'snoozed')
              window.__snoozeWakePages.push(result.threads.map((row) => row.id))
            return result
          }
        },
        { scenario, freshTitle }
      )
      await snapshot(page, `snooze-wake-${scenario}-before`)
      if (scenario === 'still-parked') {
        await page.evaluate(() => window.__pushSync({ kind: 'reset', reason: 'inbox-reply' }))
        await snoozed.getByText(freshTitle, { exact: true }).waitFor()
        assert(
          await page.evaluate(() => window.__snoozeSchedule.get('thread-launch') > Date.now()),
          'the selected thread still has a future scheduled wake',
          'the parked schedule expired unexpectedly'
        )
        assert(
          (await waking.count()) === 1 &&
            (await content.getByRole('heading', { name: selected, exact: true }).count()) === 1,
          'Inbox membership does not evict a still-parked off-page thread',
          'a still-parked Inbox thread was removed from Snoozed'
        )
        await snapshot(page, 'snooze-wake-still-parked-after')
        continue
      }
      await page.clock.fastForward(48 * 60 * 60 * 1000)
      await page.waitForFunction(
        () =>
          window.__snoozeSchedule.size === 0 &&
          window.__snoozeWakePages.some((ids) => !ids.includes('thread-launch'))
      )
      const wake = await page.evaluate(() => window.__mods.at(-1))
      if (scenario === 'lookup-error' || scenario === 'lookup-not-found') {
        await snoozed
          .getByText(freshTitle, { exact: true })
          .waitFor({ timeout: 2000 })
          .catch(() => {})
        assert(
          (await snoozed.getByText(freshTitle, { exact: true }).count()) === 1,
          `${scenario}: a failed selected lookup still applies the fresh Snoozed page`,
          `${scenario}: selected lookup failure discarded the fresh Snoozed page`
        )
      }
      if (scenario === 'lookup-error') {
        await page.getByText(/Wake membership unavailable/).waitFor()
        assert(
          (await waking.count()) === 1 &&
            (await content.getByRole('heading', { name: selected, exact: true }).count()) === 1,
          'a failed wake membership lookup preserves the row and selection',
          'a failed lookup discarded the selection'
        )
        await page.evaluate(() => window.__pushSync({ kind: 'reset', reason: 'wake-retry' }))
      }
      assert(
        wake.id === 'thread-launch' &&
          wake.addLabelIds.includes('INBOX') &&
          wake.removeLabelIds.includes('Snoozed by Mailsy'),
        'the timed sweep restores the thread and the Snoozed refetch excludes it',
        'wake did not reach the provider boundary'
      )
      await waking.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
      assert(
        (await waking.count()) === 0,
        'the woken thread leaves Snoozed even while selected',
        'the selected woken thread remained in Snoozed after the refetch'
      )
      if (selected === 'Launch checklist') {
        await content.getByText('Nothing open yet :P').waitFor()
        assert(true, 'the selected woken conversation closes', 'the woken conversation stayed open')
      } else {
        assert(
          (await content.getByRole('heading', { name: selected, exact: true }).count()) === 1,
          'an unrelated parked conversation stays open',
          'waking another thread closed the selection'
        )
      }
      if (scenario === 'selected')
        assert(
          (await snoozed.locator('li').count()) === 0,
          'waking the only parked thread leaves an empty Snoozed list',
          'empty Snoozed retained a stale row'
        )
      else await snoozed.getByText(freshTitle, { exact: true }).waitFor()
      await snapshot(page, `snooze-wake-${scenario}-after`)
      await page.getByRole('button', { name: 'Inbox', exact: true }).click()
      await inbox.getByText('Launch checklist', { exact: true }).waitFor()
      await content.getByText('Nothing open yet :P').waitFor()
      assert(
        true,
        'Inbox lists the woken thread without reopening a stale selection',
        'wake lost the thread or retained a stale selection'
      )
    }
    return 'snooze-wake'
  })
  journeys.set('snooze-emulation', async () => {
    // The emulated snooze: Mailsy parks a thread with the 'Snoozed by
    // Mailsy' user label plus an INBOX removal, records the wake time, and
    // the wake (the mocked sweep under fast-forward time) restores it to
    // the Inbox. The mock holds the schedule; the clock makes the wake
    // deterministic without waiting real 24-hour presets out.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    // Park from the detail pane through the Tomorrow preset.
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'snooze', exact: true }).click()
    assert(
      (await content.getByRole('button', { name: 'Next week', exact: true }).count()) === 1,
      'snooze opens the preset choices',
      'preset choices did not open'
    )
    await content.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await inbox
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'snoozed row left the Inbox list', 'row stayed listed')
    await content.getByText('Nothing open yet :P').waitFor({ timeout: 10000 })
    assert(true, 'detail pane closed after snooze', 'detail pane stayed open')
    // The wake of record is the schedule entry, not the label alone.
    const schedule = await page.evaluate(() => [...(window.__snoozeSchedule ?? [])])
    assert(
      schedule.length === 1 &&
        schedule[0][0] === 'thread-launch' &&
        schedule[0][1] > Date.now(),
      `wake schedule recorded ${JSON.stringify(schedule)}`,
      'wake schedule not recorded'
    )
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-launch' &&
        (mods[0].addLabelIds ?? []).includes('Snoozed by Mailsy') &&
        (mods[0].removeLabelIds ?? []).includes('INBOX'),
      `park mod recorded ${JSON.stringify(mods)}`,
      'park modifyLabels side effect not recorded'
    )
    // The Snoozed rail is the union: the emulated row lists beside the
    // native parked mail, deduped to one entry per concept.
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    const snoozed = page.getByRole('complementary', { name: 'Snoozed' })
    await snoozed.waitFor({ timeout: 10000 })
    await snoozed.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'emulated parked thread lists in the Snoozed view', 'emulated row missing')
    await snoozed
      .getByText('Vendor pricing follow-up', { exact: true })
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'native parked thread still lists in the Snoozed view', 'native row missing')
    // All Mail keeps parked mail visible regardless of which side parked it.
    await page.getByRole('button', { name: 'All Mail', exact: true }).click()
    const allMail = page.getByRole('complementary', { name: 'All Mail' })
    await allMail.waitFor({ timeout: 10000 })
    await allMail
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'All Mail still lists the emulated parked thread', 'emulated row missing from All Mail')
    // The wake: fast-forward past the preset's absolute time. The renderer's
    // tick sweeps the mock schedule, restores the pair, and the refreshed
    // Inbox lists the returned thread.
    await page.evaluate(() => {
      for (let i = 1; i <= 31; i++) {
        window.__deliverMail({ subject: `Wake pagination ${i}`, snippet: 'Launch checklist notes', prepend: i <= 14 })
      }
      const api = window.__packagedFixtureApi ?? window.api
      const snoozeTick = api.snoozeTick
      let held = false
      api.snoozeTick = async () => {
        if (held) return 0
        held = true
        await new Promise((release) => { window.__releaseSnoozeTick = release })
        api.snoozeTick = snoozeTick
        return snoozeTick()
      }
    })
    await page.clock.fastForward(48 * 60 * 60 * 1000)
    await page.waitForFunction(() => Boolean(window.__releaseSnoozeTick), undefined, { timeout: 5000 })
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.getByText('Wake pagination 1', { exact: true }).waitFor({ timeout: 5000 })
    const query = page.getByRole('searchbox', { name: 'Search emails' })
    await query.fill('Launch checklist')
    await query.press('Enter')
    await inbox.getByText('10 results for “Launch checklist”', { exact: true }).waitFor({ timeout: 5000 })
    await activateLoadMore(page, inbox)
    const tail = inbox.getByText('Wake pagination 19', { exact: true })
    const returned = inbox.getByText('Launch checklist', { exact: true }).first()
    await tail.waitFor({ timeout: 5000 })
    assert(
      (await returned.count()) === 0,
      'Inbox loads both pages before the wake restores the thread',
      'the wake completed before Inbox pagination'
    )
    const inboxRows = await inbox.getByRole('listitem').count()
    await page.evaluate(() => {
      const api = window.__packagedFixtureApi ?? window.api
      const listFolder = api.listFolder
      window.__wakeListings = []
      api.listFolder = (options) => {
        window.__wakeListings.push(options)
        return listFolder(options)
      }
      window.__restoreWakeListings = () => { api.listFolder = listFolder }
      window.__releaseSnoozeTick()
    })
    await returned.waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: the late wake forgot to refresh the open Inbox')
    })
    const listings = await page.evaluate(() => {
      window.__restoreWakeListings()
      return window.__wakeListings
    })
    assert(
      listings.length > 0 &&
        listings.every(({ folder, q }) => folder === 'inbox' && q === 'Launch checklist') &&
        (await inbox.getByRole('listitem').count()) === inboxRows &&
        (await tail.count()) === 1,
      'a late wake refreshes the loaded Inbox search without dropping page two',
      'the late wake refreshed the wrong view or lost loaded search results'
    )
    for (const count of [20, 30]) {
      await inbox.getByText(`${count} results for “Launch checklist”`, { exact: true }).waitFor({ timeout: 5000 })
      await activateLoadMore(page, inbox)
    }
    await inbox.getByText('End of results', { exact: true }).waitFor({ timeout: 5000 })
    const matches = ['Launch checklist', ...Array.from({ length: 31 }, (_, i) => `Wake pagination ${i + 1}`)]
    const matchesOnce = await Promise.all(matches.map((subject) => inbox.getByText(subject, { exact: true }).count()))
    assert(
      matchesOnce.every((count) => count === 1) && (await inbox.getByRole('listitem').count()) === matches.length,
      'the resumed search reaches every match exactly once',
      'the resumed search skipped or duplicated a result'
    )
    await snapshot(page, 'snooze-wake-view-switch')
    await inbox.getByRole('button', { name: 'Clear search' }).click()
    const scheduleAfterWake = await page.evaluate(() => [...(window.__snoozeSchedule ?? [])])
    assert(
      scheduleAfterWake.length === 0,
      'wake cleared the schedule record',
      'schedule record survived the wake'
    )
    const wakeMods = await page.evaluate(() => window.__mods)
    assert(
      wakeMods.length === 2 &&
        wakeMods[1].kind === 'thread' &&
        wakeMods[1].id === 'thread-launch' &&
        (wakeMods[1].addLabelIds ?? []).includes('INBOX') &&
        (wakeMods[1].removeLabelIds ?? []).includes('Snoozed by Mailsy'),
      `wake restore mod recorded ${JSON.stringify(wakeMods)}`,
      'wake restore side effect not recorded'
    )
    // A second park with the far preset, then a manual unsnooze that
    // overrides its wake: the restore is the reverse pair and drops the
    // schedule record immediately.
    await page
      .getByRole('complementary', { name: 'Inbox' })
      .getByText('Q3 budget draft', { exact: true })
      .first()
      .click()
    await page.getByRole('heading', { name: 'Q3 budget draft' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'snooze', exact: true }).click()
    await content.getByRole('button', { name: 'Next week', exact: true }).click()
    await inbox
      .getByText('Q3 budget draft', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    await snoozed.waitFor({ timeout: 10000 })
    const parkedLi = snoozed.locator('li', { hasText: 'Q3 budget draft' }).first()
    await parkedLi.waitFor({ timeout: 10000 })
    await parkedLi.getByRole('button', { name: 'unsnooze', exact: true }).click()
    await parkedLi.waitFor({ state: 'detached', timeout: 10000 })
    assert(true, 'manual unsnooze removed the emulated row', 'row stayed listed')
    const scheduleAfterRestore = await page.evaluate(() => [...(window.__snoozeSchedule ?? [])])
    assert(
      scheduleAfterRestore.length === 0,
      'manual unsnooze cleared the schedule record before its wake',
      'schedule record survived the manual unsnooze'
    )
    const restoreMods = await page.evaluate(() => window.__mods)
    assert(
      restoreMods.length === 4 &&
        restoreMods[3].kind === 'thread' &&
        restoreMods[3].id === 'thread-budget' &&
        (restoreMods[3].addLabelIds ?? []).includes('INBOX') &&
        (restoreMods[3].removeLabelIds ?? []).includes('Snoozed by Mailsy'),
      `restore pair recorded ${JSON.stringify(restoreMods)}`,
      'restore pair side effect not recorded'
    )
    // Restore from the detail pane: re-park and unsnooze through the open
    // thread, the same verb the row button reaches.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'snooze', exact: true }).click()
    await content.getByRole('button', { name: 'Later this week', exact: true }).click()
    await inbox
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    await snoozed.waitFor({ timeout: 10000 })
    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      await api.modifyLabels({ kind: 'thread', id: 'thread-launch', addLabelIds: ['UNREAD'] })
    })
    await query.fill('is:unread Launch checklist')
    await query.press('Enter')
    await snoozed.getByText(/results? for “is:unread Launch checklist”/).waitFor({ timeout: 5000 })
    const snoozedResult = snoozed.getByText('Launch checklist', { exact: true }).first()
    await snoozedResult.click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await page.waitForFunction(() => window.__mods.at(-1)?.removeLabelIds?.includes('UNREAD'))
    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      const { threads } = await api.listFolder({ folder: 'snoozed' })
      const { snoozedByMailsy, ...row } = threads.find(({ id }) => id === 'thread-launch')
      window.__pushSync({
        kind: 'delta', historyId: 'snoozed-read',
        threads: [{ ...row, labelIds: ['Snoozed by Mailsy'] }], deletedThreadIds: []
      })
    })
    await snoozedResult.waitFor({ state: 'detached', timeout: 5000 })
    await content.getByRole('button', { name: 'unsnooze', exact: true }).click()
    await snoozed
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    await content.getByRole('button', { name: 'unsnooze', exact: true }).waitFor({ state: 'detached', timeout: 5000 })
    const detailRestoreMod = await page.evaluate(() => window.__mods.at(-1))
    assert(
      detailRestoreMod.kind === 'thread' &&
        detailRestoreMod.id === 'thread-launch' &&
        (detailRestoreMod.addLabelIds ?? []).includes('INBOX') &&
        (detailRestoreMod.removeLabelIds ?? []).includes('Snoozed by Mailsy'),
      `detail restore pair survives the search change: ${JSON.stringify(detailRestoreMod)}`,
      'search lost Mailsy parking metadata and left the snooze label attached'
    )
    const scheduleFinal = await page.evaluate(() => [...(window.__snoozeSchedule ?? [])])
    assert(
      scheduleFinal.length === 0,
      'detail restore cleared the schedule record',
      'schedule record survived the detail restore'
    )
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'detail restore returned the thread to the Inbox', 'thread missing from the Inbox')
    await snapshot(page, 'snooze-emulation')

    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      await api.snoozeThread('thread-launch', Date.now() + 1000)
    })
    await page.getByRole('button', { name: 'All Mail', exact: true }).click()
    await allMail.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 5000 })
    await activateLoadMore(page, allMail)
    const allMailTail = allMail.getByText('Wake pagination 31', { exact: true })
    await allMailTail.waitFor({ timeout: 5000 })
    const allMailRows = await allMail.getByRole('listitem').count()
    await page.evaluate(() => {
      const api = window.__packagedFixtureApi ?? window.api
      const listFolder = api.listFolder
      window.__allMailRelists = 0
      api.listFolder = (options) => {
        if (options.folder === 'all') window.__allMailRelists++
        return listFolder(options)
      }
    })
    await page.clock.fastForward(30000)
    await page.waitForFunction(() => [...window.__snoozeSchedule].length === 0, undefined, { timeout: 5000 })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert(
      (await page.evaluate(() => window.__allMailRelists)) === 0 &&
        (await allMailTail.count()) === 1 &&
        (await allMail.getByRole('listitem').count()) === allMailRows,
      'a wake in All Mail leaves both already loaded pages intact',
      'a wake collapsed the loaded All Mail pages'
    )
    await snapshot(page, 'snooze-wake-all-mail')

    await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      await api.snoozeThread('thread-launch', Date.now() + 1000)
    })
    await query.fill('-in:inbox')
    await query.press('Enter')
    const excludedAfterWake = allMail.getByText('Launch checklist', { exact: true }).first()
    await allMail.getByText(/results for “-in:inbox”/).waitFor({ timeout: 5000 })
    await excludedAfterWake.waitFor({ timeout: 5000 })
    await page.clock.fastForward(30000)
    await excludedAfterWake.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: search keeps a stale match after the snoozed mail returned to Inbox')
    })
    await allMail.getByText('Vendor pricing follow-up', { exact: true }).first().waitFor({ timeout: 5000 })
    assert(true, 'a wake removes a no-longer-matching search result', 'excluded mail stayed in search')
    await snapshot(page, 'snooze-wake-search-exclusion')
    return 'snooze-emulation'
  })
  journeys.set('category-views', async () => {
    // The Important view is the IMPORTANT label: it lists the seeded
    // important mail and nothing labeled for a category tab.
    await page.getByRole('button', { name: 'Important', exact: true }).click()
    const important = page.getByRole('complementary', { name: 'Important' })
    await important.waitFor({ timeout: 10000 })
    await important
      .getByText('Budget approval needed by Friday', { exact: true })
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'Important view lists the seeded important mail', 'important row missing')
    assert(
      (await important.getByText('Weekend meetup photos', { exact: true }).count()) === 0,
      'the Social thread stays out of the Important view',
      'Important view mixed in another label row'
    )
    // Each category view lists only threads carrying its own CATEGORY_*
    // label; the mock re-derives the page from label state, not a filter.
    const views = [
      ['Social', 'Weekend meetup photos'],
      ['Promotions', 'Trail shoes flash sale'],
      ['Updates', 'Your storage usage report'],
      ['Forums', 'New reply in your thread']
    ]
    for (const [rail, subject] of views) {
      await page.getByRole('button', { name: rail, exact: true }).click()
      const view = page.getByRole('complementary', { name: rail })
      await view.waitFor({ timeout: 10000 })
      await view.getByText(subject, { exact: true }).first().waitFor({ timeout: 10000 })
      assert(true, `${rail} view lists its seeded thread`, `${rail} row missing`)
      if (rail === 'Social') {
        assert(
          (await view.getByText('Budget approval needed by Friday', { exact: true }).count()) === 0,
          'the Important thread stays out of the Social view',
          'Social view mixed in an unrelated label row'
        )
      }
    }
    // Selecting from a category view opens the normal detail, like Inbox.
    await page.getByRole('button', { name: 'Social', exact: true }).click()
    await page
      .getByRole('complementary', { name: 'Social' })
      .getByText('Weekend meetup photos', { exact: true })
      .first()
      .click()
    await page.getByRole('heading', { name: 'Weekend meetup photos' }).waitFor({ timeout: 10000 })
    assert(true, 'selecting from a category view opens the detail', 'detail did not open')
    // A category label is not an All Mail removal: the Gmail API's no-label
    // default excludes only SPAM and TRASH, so category and important mail
    // still lists there.
    await page.getByRole('button', { name: 'All Mail', exact: true }).click()
    const allMail = page.getByRole('complementary', { name: 'All Mail' })
    await allMail.waitFor({ timeout: 10000 })
    await allMail.getByText('Weekend meetup photos', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(true, 'category mail still lists in All Mail', 'category row missing from All Mail')
    await allMail
      .getByText('Budget approval needed by Friday', { exact: true })
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'important mail still lists in All Mail', 'important row missing from All Mail')
    await snapshot(page, 'category-views')
    return 'category-views'
  })
  journeys.set('unread-bold', async () => {
    // Unread rows bold across every folder view, read rows normal, with
    // the weight read off the rendered DOM as the proof. Unread rows are
    // produced on the real path (the row's mark-unread toggle), so the
    // state folds through the same handlers the app uses.
    const subjectWeightOf = (row) =>
      row.locator('.email-text').first().evaluate((el) => getComputedStyle(el).fontWeight)
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const row = inbox.locator('li', { hasText: 'Launch checklist' }).first()
    const readSubject = await subjectWeightOf(row)
    assert(readSubject === '400', `read row subject renders normal weight (${readSubject})`, 'read row text renders bold')
    const readFrom = await row.locator('.from').evaluate((el) => getComputedStyle(el).fontWeight)
    assert(readFrom === '400', `read row sender renders normal weight (${readFrom})`, 'read row sender renders bold')
    assert((await page.locator('li.unread').count()) === 0, 'seeded rows arrive read', 'seeded rows arrived unread')
    // The row toggle marks the thread unread: the bold affordance appears
    // on subject and sender through the li.unread class.
    await row.getByRole('button', { name: 'mark unread', exact: true }).click()
    await row.getByRole('button', { name: 'mark read', exact: true }).waitFor({ timeout: 10000 })
    assert((await page.locator('li.unread').count()) === 1, 'toggled row carries the unread class', 'unread row class missing')
    const unreadSubject = await subjectWeightOf(row)
    assert(unreadSubject === '700', `unread row subject renders bold (${unreadSubject})`, 'unread row subject not bold')
    const unreadFrom = await row.locator('.from').evaluate((el) => getComputedStyle(el).fontWeight)
    assert(unreadFrom === '700', `unread row sender renders bold (${unreadFrom})`, 'unread row sender not bold')
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-launch' &&
        (mods[0].addLabelIds ?? []).includes('UNREAD'),
      `mark-unread mod recorded ${JSON.stringify(mods)}`,
      'mark-unread modifyLabels side effect not recorded'
    )
    // The refresh fold re-derives rows from label state through
    // mergeIncoming; the bold state must survive the fold.
    await page.getByRole('button', { name: 'Refresh mail' }).click()
    await page.waitForTimeout(1500)
    const folded = await inbox.locator('li.unread', { hasText: 'Launch checklist' }).count()
    assert(folded === 1, 'bold survives the refetch fold-in', 'unread state lost in the fold')
    assert((await subjectWeightOf(row)) === '700', 'folded row still renders bold', 'folded row lost the bold weight')
    // Same thread, same bold state, different folder view: All Mail.
    await page.getByRole('button', { name: 'All Mail' }).click()
    const allMail = page.getByRole('complementary', { name: 'All Mail' })
    const allRow = allMail.locator('li', { hasText: 'Launch checklist' }).first()
    await allRow.waitFor({ timeout: 10000 })
    assert((await subjectWeightOf(allRow)) === '700', 'unread row is bold in All Mail', 'unread row not bold in All Mail')
    const allReadRow = allMail.locator('li', { hasText: 'Q3 budget draft' }).first()
    assert((await subjectWeightOf(allReadRow)) === '400', 'read row is normal weight in All Mail', 'read row bold in All Mail')
    // Snoozed view: one row toggled unread next to a read parked row.
    await page.getByRole('button', { name: 'Snoozed', exact: true }).click()
    const snoozed = page.getByRole('complementary', { name: 'Snoozed' })
    await snoozed.waitFor({ timeout: 10000 })
    const parkedRow = snoozed.locator('li', { hasText: 'Vendor pricing follow-up' }).first()
    await parkedRow.getByRole('button', { name: 'mark unread', exact: true }).click()
    await parkedRow.getByRole('button', { name: 'mark read', exact: true }).waitFor({ timeout: 10000 })
    assert((await subjectWeightOf(parkedRow)) === '700', 'unread parked row renders bold in Snoozed', 'unread parked row not bold in Snoozed')
    const parkedReadRow = snoozed.locator('li', { hasText: 'Newsletter backlog cleanup' }).first()
    assert((await subjectWeightOf(parkedReadRow)) === '400', 'read parked row stays normal in Snoozed', 'read parked row bold in Snoozed')
    // Category view: the same treatment on a Promotions row.
    await page.getByRole('button', { name: 'Promotions', exact: true }).click()
    const promotions = page.getByRole('complementary', { name: 'Promotions' })
    await promotions.waitFor({ timeout: 10000 })
    const promoRow = promotions.locator('li', { hasText: 'Trail shoes flash sale' }).first()
    await promoRow.getByRole('button', { name: 'mark unread', exact: true }).click()
    await promoRow.getByRole('button', { name: 'mark read', exact: true }).waitFor({ timeout: 10000 })
    assert((await subjectWeightOf(promoRow)) === '700', 'unread row renders bold in Promotions', 'unread row not bold in Promotions')
    // Opening the unread thread marks it read automatically: the bold
    // affordance clears the moment the mutation lands.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    const autoReadMods = () => page.evaluate(() => window.__mods)
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    const endMods = await autoReadMods()
    assert(endMods.length === 4, `four mods recorded ${JSON.stringify(endMods)}`, 'unexpected modifyLabels call count')
    assert(
      endMods[3].kind === 'thread' &&
        endMods[3].id === 'thread-launch' &&
        (endMods[3].removeLabelIds ?? []).includes('UNREAD'),
      `auto-read mod recorded ${JSON.stringify(endMods)}`,
      'auto-read did not send the UNREAD removal'
    )
    const cleared = await inbox.locator('li.unread', { hasText: 'Launch checklist' }).count()
    assert(cleared === 0, 'bold clears as soon as the thread is read', 'row stayed unread after open')
    const clearedWeight = await subjectWeightOf(inbox.locator('li', { hasText: 'Launch checklist' }).first())
    assert(clearedWeight === '400', `read row is normal weight again (${clearedWeight})`, 'row kept the bold weight after read')
    await snapshot(page, 'unread-bold')
    return 'unread-bold'
  })
  journeys.set('sidebar', async () => {
    // The folder rail: every affordance renders once and opens its view.
    // The rail's labels surface stays hidden in the default view; the
    // `labels` journey proves that absence too.
    const rail = page.getByRole('navigation', { name: 'Mail folders' })
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    const FOLDERS = [
      'Inbox',
      'Starred',
      'Snoozed',
      'Important',
      'Social',
      'Promotions',
      'Updates',
      'Forums',
      'Drafts',
      'Sent',
      'Spam',
      'Trash',
      'All Mail'
    ]
    for (const name of FOLDERS) {
      const count = await rail.getByRole('button', { name, exact: true }).count()
      assert(
        count === 1,
        `the ${name} rail affordance is unique`,
        `rail affordance for ${name} missing or duplicated (count ${count})`
      )
    }
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 0,
      'the rail hides the labels surface in the default view',
      'New label affordance rendered in the default view'
    )
    // Clicks open their views; sample the ends of the rail where a dead
    // affordance would stop real folder browsing.
    await rail.getByRole('button', { name: 'All Mail', exact: true }).click()
    await page.getByRole('complementary', { name: 'All Mail' }).waitFor({ timeout: 10000 })
    log('pass: the All Mail affordance opens its view')
    await rail.getByRole('button', { name: 'Trash', exact: true }).click()
    await page.getByRole('complementary', { name: 'Trash' }).waitFor({ timeout: 10000 })
    log('pass: the Trash affordance opens its view')
    await rail.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    log('pass: the Inbox affordance opens its view again')
    await snapshot(page, 'sidebar')
    return 'sidebar'
  })
  journeys.set('sidebar-expanded', async () => {
    // The expanded sidebar: one control flips the icon rail to named rows
    // and re-exposes the labels section the default view gates off. The
    // state must survive a folder switch and collapse clean again.
    const rail = page.getByRole('navigation', { name: 'Mail folders' })
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 0,
      'the default view still gates the labels section off',
      'New label affordance rendered before the sidebar was expanded'
    )
    const toggle = rail.getByRole('button', { name: 'Expand sidebar', exact: true })
    assert(
      (await toggle.count()) === 1,
      'the rail carries exactly one expand control',
      'expand control missing or duplicated'
    )
    // The drawer is an overlay: the mail column must keep its exact spot
    // when the rail widens, so the list's own box is measured before and
    // after the expansion and compared. The first folder icon's box is
    // measured the same way: expanding must reveal names around the
    // icons, never re-anchor the icons themselves.
    const listBefore = await page.getByRole('complementary', { name: 'Inbox' }).boundingBox()
    const iconBefore = await page
      .locator('.folder-rail-button')
      .first()
      .locator('svg')
      .first()
      .boundingBox()
    const pillBefore = await rail.locator('.folder-rail-button.active').first().boundingBox()
    // The collapsed Tag reveal is the state expansion has to preserve:
    // show the chips first, so the round trip ends where this journey began.
    await rail.getByRole('button', { name: 'Labels', exact: true }).click()
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 1,
      'the collapsed Tag toggle reveals the labels surface',
      'the Tag toggle did not reveal the labels surface'
    )
    await toggle.click()
    await rail
      .getByRole('button', { name: 'Collapse sidebar', exact: true })
      .waitFor({ timeout: 10000 })
    log('pass: expanding flips the control to Collapse sidebar')
    assert(
      (await rail.getByRole('button', { name: 'Labels', exact: true }).count()) === 0,
      'the collapsed-only Tag toggle is gone while expanded',
      'the Tag toggle survived the expansion'
    )
    const listAfter = await page.getByRole('complementary', { name: 'Inbox' }).boundingBox()
    assert(
      Math.abs(listAfter.x - listBefore.x) < 0.5 && Math.abs(listAfter.y - listBefore.y) < 0.5,
      'the mail column keeps its exact spot while the drawer is open',
      `expanding moved the mail column (measured at the list box: before x=${listBefore.x} y=${listBefore.y}, after x=${listAfter.x} y=${listAfter.y})`
    )
    const iconAfter = await page
      .locator('.folder-rail-button')
      .first()
      .locator('svg')
      .first()
      .boundingBox()
    assert(
      Math.abs(iconAfter.x - iconBefore.x) < 0.5 &&
        Math.abs(iconAfter.y - iconBefore.y) < 0.5 &&
        Math.abs(iconAfter.width - iconBefore.width) < 0.5 &&
        Math.abs(iconAfter.height - iconBefore.height) < 0.5,
      'the folder icons keep their exact size and spot while the drawer is open',
      `expanding moved the folder icon (measured: before x=${iconBefore.x} y=${iconBefore.y} w=${iconBefore.width} h=${iconBefore.height}, after x=${iconAfter.x} y=${iconAfter.y} w=${iconAfter.width} h=${iconAfter.height})`
    )
    // The highlight is the collapsed pill drawn longer, not a full-bleed
    // bar: the active button's left edge stays where the collapsed square
    // sat and its width stays at least a collapsed square short of the
    // drawer's inner width (the 6px inset each side).
    const drawerWidth = (await rail.boundingBox()).width
    // The highlight is the collapsed pill drawn longer, not a full-bleed
    // bar: the active button's left edge stays where the collapsed square
    // sat and its width stays at least a collapsed square short of the
    // drawer's inner width (the 6px inset each side).
    const pillAfter = await rail.locator('.folder-rail-button.active').first().boundingBox()
    assert(
      pillAfter !== null &&
        pillBefore !== null &&
        Math.abs(pillAfter.x - pillBefore.x) < 0.5 &&
        pillAfter.width < drawerWidth - 12,
      'the active highlight renders the collapsed pill shape inset in the open drawer',
      `the active highlight is not the collapsed pill in the open drawer (before x=${pillBefore?.x} w=${pillBefore?.width}, after x=${pillAfter?.x} w=${pillAfter?.width}, drawer width=${drawerWidth})`
    )
    const FOLDERS = [
      'Inbox',
      'Starred',
      'Snoozed',
      'Important',
      'Social',
      'Promotions',
      'Updates',
      'Forums',
      'Drafts',
      'Sent',
      'Spam',
      'Trash',
      'All Mail'
    ]
    for (const name of FOLDERS) {
      const count = await rail.getByRole('button', { name, exact: true }).count()
      assert(
        count === 1,
        `the ${name} row is unique while expanded`,
        `expanded rail affordance for ${name} missing or duplicated (count ${count})`
      )
    }
    assert(
      (await rail.getByText('Labels', { exact: true }).count()) === 1,
      'the expanded rail shows one Labels section heading',
      'Labels section heading missing or duplicated while expanded'
    )
    // The seeded user label re-exposed as the section the default view
    // hides: chip rows show the label's name, New label opens the create
    // form the collapsed Tag toggle used to reveal.
    await rail.getByText('Receipts', { exact: true }).waitFor({ timeout: 10000 })
    log('pass: the labels section re-exposes the seeded label by name')
    // The labels surface draws from the same shape: the chip plate stays
    // the pill (its left edge where the highlight's is, inset, not
    // full-bleed) while the drawer is open.
    const chipBox = await rail.locator('.user-label-chip').first().boundingBox()
    assert(
      chipBox !== null &&
        pillAfter !== null &&
        Math.abs(chipBox.x - pillAfter.x) < 0.5 &&
        chipBox.width < drawerWidth - 12,
      'the label chip plate renders the same inset pill as the highlight',
      `the chip plate is not the inset pill (chip x=${chipBox?.x} w=${chipBox?.width}, pill x=${pillAfter?.x}, drawer width=${drawerWidth})`
    )
    await rail.getByRole('button', { name: 'New label', exact: true }).click()
    await rail.getByRole('textbox', { name: 'Label name' }).waitFor({ timeout: 10000 })
    log('pass: New label opens its inline form while expanded')
    await rail.getByRole('textbox', { name: 'Label name' }).press('Escape')
    // A label selection folds the drawer too, and the collapsed rail
    // answers "which label" with a tile in the label's own color where
    // the Tag toggle otherwise sits (Spark-style). The tile click is the
    // way back to the labels surface.
    await rail.getByRole('button', { name: 'Receipts', exact: true }).click()
    await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).waitFor({ timeout: 10000 })
    log('pass: selecting a label collapses the open drawer')
    const tile = rail.getByRole('button', { name: 'Labels: Receipts', exact: true })
    assert(
      (await tile.count()) === 1,
      'the collapsed rail shows the active label as its own tile',
      'the active label tile is missing or duplicated in the collapsed rail'
    )
    await tile.click()
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 1,
      'the tile click reveals the labels surface the Tag toggle would',
      'clicking the active label tile did not reveal the labels surface'
    )
    log('pass: the active label tile opens the labels surface')
    // Selecting a view folds the drawer: it is an overlay, so the chosen
    // folder gets its full width back at once and the rails' chips state
    // rides the collapse unchanged.
    await rail.getByRole('button', { name: 'Trash', exact: true }).click()
    await page.getByRole('complementary', { name: 'Trash' }).waitFor({ timeout: 10000 })
    assert(
      (await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).count()) === 1,
      'selecting a folder collapses the open drawer',
      'the rail stayed expanded after a folder selection'
    )
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 1,
      'the chips the Tag toggle left are still on screen after the collapse',
      'the chips-shown state was lost when the drawer collapsed'
    )
    await rail.getByRole('button', { name: 'Hide labels', exact: true }).click()
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 0,
      'the default view is restored after collapsing and hiding',
      'the labels surface stayed open in the default view'
    )
    await rail.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    log('pass: collapsing returns the default view and folder browsing works')
    await snapshot(page, 'sidebar-expanded')
    return 'sidebar-expanded'
  })
  journeys.set('labels', async () => {
    // The detail pane's Labels menu applies and removes labels on the
    // open thread. The rail's chips and New label affordance are the
    // expanded-sidebar surface, hidden in the default view; the `sidebar`
    // journey proves that absence too.
    const rail = page.getByRole('navigation', { name: 'Mail folders' })
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    const content = page.getByRole('region', { name: 'Email content' })
    await inbox.waitFor({ timeout: 10000 })
    assert(
      (await rail.getByRole('button', { name: 'Receipts', exact: true }).count()) === 0,
      'the rail shows no label chips in the default view',
      'label chip rendered while the rail labels surface is gated off'
    )
    assert(
      (await rail.getByRole('button', { name: 'New label', exact: true }).count()) === 0,
      'the rail shows no New label affordance in the default view',
      'New label button rendered while the rail labels surface is gated off'
    )
    // Open the seeded labeled thread from the Inbox, then the detail
    // pane's Labels menu and its checked write.
    await inbox.getByText('Receipts for March travel', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Receipts for March travel' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'Labels', exact: true }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'Labels', exact: true }).click()
    const menu = content.getByRole('group', { name: 'Apply labels' })
    const receiptBox = menu.getByRole('checkbox', { name: 'Receipts', exact: true })
    await receiptBox.waitFor({ timeout: 10000 })
    await waitForChecked(
      receiptBox,
      true,
      'open thread carries a checked Receipts label',
      'Receipts checkbox not checked on the open thread'
    )
    await receiptBox.click()
    await waitForChecked(
      receiptBox,
      false,
      'removing the label clears the checkbox',
      'Receipts checkbox stayed checked after the removal'
    )
    const mods = await page.evaluate(() => window.__mods)
    assert(
      mods.length === 1 &&
        mods[0].kind === 'thread' &&
        mods[0].id === 'thread-receipts-1' &&
        mods[0].addLabelIds === undefined &&
        (mods[0].removeLabelIds ?? []).includes('label-receipts'),
      `remove mod recorded ${JSON.stringify(mods)}`,
      'label-remove modifyLabels side effect not recorded'
    )
    // Persistence: a folder round trip re-derives the menu from the
    // boundary's label state. Inbox still lists the thread (the label
    // removal never touched INBOX), and its menu opens with the box
    // unchecked.
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    const refetchedInbox = page.getByRole('complementary', { name: 'Inbox' })
    await refetchedInbox.waitFor({ timeout: 10000 })
    await refetchedInbox.getByText('Receipts for March travel', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Receipts for March travel' }).waitFor({ timeout: 10000 })
    // The detail pane stays mounted across a same-thread refetch, so the
    // Labels menu may still be expanded from the removal; only click when
    // it is closed.
    if ((await content.getByRole('group', { name: 'Apply labels' }).count()) === 0) {
      await content.getByRole('button', { name: 'Labels', exact: true }).click()
    }
    const reloadedBox = content
      .getByRole('group', { name: 'Apply labels' })
      .getByRole('checkbox', { name: 'Receipts', exact: true })
    await reloadedBox.waitFor({ timeout: 10000 })
    await waitForChecked(
      reloadedBox,
      false,
      'the removal survived the refetch round trip',
      'removed label reappeared checked after refetch'
    )
    await reloadedBox.click()
    await waitForChecked(
      reloadedBox,
      true,
      're-applying from the detail pane checks the label again',
      're-applied label failed its checked read back'
    )
    const applyMods = await page.evaluate(() => window.__mods)
    assert(
      applyMods.length === 2 &&
        (applyMods[1].addLabelIds ?? []).includes('label-receipts'),
      `apply mod recorded ${JSON.stringify(applyMods)}`,
      'label-apply modifyLabels side effect not recorded'
    )
    await snapshot(page, 'labels')
    await rail.getByRole('button', { name: 'Labels', exact: true }).click()
    await rail.getByRole('button', { name: 'Receipts', exact: true }).click()
    const labelList = page.getByRole('complementary', { name: 'Receipts', exact: true })
    await labelList.getByText('Receipts for March travel', { exact: true }).first().waitFor()
    assert(
      (await labelList.getByText('No mail with this label', { exact: true }).count()) === 0,
      'a populated label has no empty-state footer',
      'a populated label also shows the empty state'
    )
    await snapshot(page, 'labels-populated')
    await labelList.getByText('Receipts for March travel', { exact: true }).first().click()
    if ((await content.getByRole('group', { name: 'Apply labels' }).count()) === 0) {
      await content.getByRole('button', { name: 'Labels', exact: true }).click()
    }
    await content.getByRole('checkbox', { name: 'Receipts', exact: true }).click()
    await labelList.getByText('No mail with this label', { exact: true }).waitFor()
    assert(
      (await labelList.getByText('Receipts for March travel', { exact: true }).count()) === 0,
      'removing the last labeled thread shows only the empty state',
      'the empty label retained a thread'
    )
    await snapshot(page, 'labels-empty')
    return 'labels'
  })
  journeys.set('refresh', async () => {
    // The live refresh channel: the Refresh button must acknowledge a
    // click instantly, dedupe in-flight clicks, and surface failures;
    // new mail must arrive through the pushed sweep without any click.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Launch checklist', { exact: false }).first().waitFor({ timeout: 10000 })
    const refresh = page.getByRole('button', { name: 'Refresh mail' })

    // The mock's sweep is slowed so the button's busy state is
    // observable before it settles; the spam clicks land mid-flight.
    await page.evaluate(() => window.__setSyncDelay(500))
    await refresh.click()
    await page
      .waitForFunction(
        () => document.querySelector('.refresh-button')?.getAttribute('aria-busy') === 'true',
        undefined,
        { timeout: 3000 }
      )
      .then(
        () => assert(true, 'a click turns the Refresh button busy at once', 'no busy state after the click'),
        (e) => assert(false, 'a click turns the Refresh button busy at once', `no busy state after the click: ${e.message}`)
      )
    await refresh.click()
    await refresh.click()
    await page
      .waitForFunction(
        () => document.querySelector('.refresh-button')?.getAttribute('aria-busy') !== 'true',
        undefined,
        { timeout: 5000 }
      )
      .then(
        () => assert(true, 'the sweep settles and the button un-busies', 'button stayed busy'),
        (e) => assert(false, 'the sweep settles and the button un-busies', `button stuck busy: ${e.message}`)
      )
    const reasons = JSON.stringify(await page.evaluate(() => window.__syncReasons))
    assert(
      reasons === JSON.stringify(['button']),
      `in-flight clicks deduped to one sweep (${reasons})`,
      'in-flight clicks were not deduped'
    )
    await snapshot(page, 'refresh-button')

    // Failures surface on the shared error line instead of silence.
    await page.evaluate(() => window.__setSyncError('mock: rate limit'))
    await refresh.click()
    const errorLine = page.locator('p.error')
    await errorLine.waitFor({ timeout: 5000 })
    assert(
      (await errorLine.textContent())?.includes('Gmail rate limit hit'),
      'a failed sweep surfaces its error',
      'failed sweep stayed silent'
    )
    await page.evaluate(() => window.__setSyncError(null))

    // New mail arrives by push, no click anywhere: the delivered message
    // enters the mock's mailbox and its delta is pushed straight at the
    // renderer, the same channel main's clock and focus sweeps use.
    await page.evaluate(() => {
      const { delta } = window.__deliverMail({
        from: 'Sweep Wire <news@delivered.example>',
        subject: 'Delivered between sweeps',
        snippet: 'New mail arrives without a click.'
      })
      window.__pushSync(delta)
    })
    await inbox.getByText('Delivered between sweeps', { exact: true }).first().waitFor({ timeout: 5000 })
    assert(true, 'a pushed delta adds the new mail to the view', 'pushed delta did not add the row')

    // The reset side of the channel: a full quiet fold of the first page
    // picks up the mailbox's real filter state, including just-delivered
    // mail the delta-blind views know nothing about.
    await page.evaluate(() => {
      window.__deliverMail({
        from: 'Fold Wire <fold@delivered.example>',
        subject: 'Delivered at the fold',
        snippet: 'Mail arriving through the full fold.'
      })
      window.__pushSync({ kind: 'reset' })
    })
    await inbox.getByText('Delivered at the fold', { exact: true }).first().waitFor({ timeout: 5000 })
    assert(true, 'a pushed reset re-folds the first page with its new mail', 'pushed reset did not re-fold')

    const firstPageSize = 30
    const rows = inbox.getByRole('listitem')
    const loadMore = inbox.getByRole('button', { name: 'Load more', exact: true })
    const remaining = firstPageSize - (await rows.count())
    assert(remaining > 0, 'the starting inbox fits on one page', 'fixtures already fill the first page')
    await page.evaluate((count) => {
      for (let i = 0; i < count; i++) window.__deliverMail({ subject: `Fill first page ${i + 1}` })
      window.__pushSync({ kind: 'reset' })
    }, remaining)
    await inbox.getByText(`Fill first page ${remaining}`, { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await rows.count()) === firstPageSize && (await loadMore.count()) === 0,
      'the open inbox has exactly one full page and no continuation',
      'expected a full first page without a Load more button'
    )

    // The fixture appends this delivery after page one, so the only route
    // to it is the continuation returned by the quiet first-page fold.
    const overflowSubject = 'Delivered onto page two'
    await page.evaluate((subject) => {
      window.__deliverMail({ subject })
      window.__pushSync({ kind: 'reset' })
    }, overflowSubject)
    await loadMore.waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: Load more did not appear after the open inbox grew past 30 threads')
    })
    assert(true, 'a pushed reset exposes Load more without reopening the inbox', 'missing continuation')
    await snapshot(page, 'refresh-pagination')
    // Focus without scrolling so the observer does not load the page first.
    await loadMore.evaluate((button) => button.focus({ preventScroll: true }))
    await page.keyboard.press('Enter')
    await inbox.getByText(overflowSubject, { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await rows.count()) === firstPageSize + 1 && (await loadMore.count()) === 0,
      'Load more reaches the new thread exactly once and exhausts the inbox',
      'page two did not append exactly one thread and exhaust pagination'
    )

    // Put this delivery on page one so its appearance proves the second
    // reset has finished before we check that it did not rewind the cursor.
    const newestSubject = 'Delivered after pagination'
    await page.evaluate((subject) => {
      window.__deliverMail({ subject, prepend: true })
      window.__pushSync({ kind: 'reset' })
    }, newestSubject)
    await inbox.getByText(newestSubject, { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await rows.count()) === firstPageSize + 2 &&
        (await inbox.getByText(overflowSubject, { exact: true }).count()) === 1 &&
        (await loadMore.count()) === 0,
      'another reset keeps the loaded tail and does not rewind completed pagination',
      'a second reset lost the loaded tail or exposed a stale continuation'
    )
    await snapshot(page, 'refresh')

    const afterTail = Array.from({ length: 31 }, (_, i) => `Delivered behind the loaded tail ${i + 1}`)
    await page.evaluate((subjects) => {
      for (const subject of subjects) window.__deliverMail({ subject })
      window.__pushSync({ kind: 'reset' })
    }, afterTail)
    await inbox.getByText(afterTail[0], { exact: true }).waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: a reset missed mail arriving beyond the first page of an exhausted Inbox')
    })
    assert(
      (await inbox.getByText(overflowSubject, { exact: true }).count()) === 1,
      'the reset keeps the previously loaded second page',
      'the reset lost or duplicated the loaded tail'
    )
    await activateLoadMore(page, inbox)
    await inbox.getByText(afterTail.at(-1), { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await rows.count()) === firstPageSize + 2 + afterTail.length &&
        (await loadMore.count()) === 0 &&
        (await Promise.all(afterTail.map((subject) => inbox.getByText(subject, { exact: true }).count())))
          .every((count) => count === 1),
      'the reset restores a continuation and reaches every delivery once across three pages',
      'the reset hid or duplicated deliveries beyond the exhausted cursor'
    )
    await snapshot(page, 'refresh-exhausted-pagination')

    await page.evaluate(() => {
      ;(window.__packagedFixtureApi ?? window.api).syncMail = () =>
        new Promise((resolve) => {
          window.__releaseRefresh = () => resolve({ kind: 'reset' })
        })
    })
    const rail = page.getByRole('navigation', { name: 'Mail folders' })
    for (const [name, folder, subject] of [
      ['Drafts', 'drafts', 'Draft: Q4 planning notes'],
      ['Receipts', 'label', 'Receipts for March travel']
    ]) {
      if (name === 'Receipts') {
        await rail.getByRole('button', { name: 'Inbox', exact: true }).click()
        await inbox.getByText('Launch checklist', { exact: true }).waitFor({ timeout: 5000 })
        const labels = rail.getByRole('button', { name: 'Labels', exact: true })
        if (await labels.count()) await labels.click()
      }
      await refresh.click()
      await page.waitForFunction(() => Boolean(window.__releaseRefresh))
      await rail.getByRole('button', { name, exact: true }).click()
      const destination = page.getByRole('complementary', { name, exact: true })
      await destination.getByText(subject, { exact: true }).waitFor({ timeout: 5000 })
      const destinationRows = destination.getByRole('listitem')
      const before = await destinationRows.count()
      const marker = `Delivered to ${name} during refresh`
      await page.evaluate(async ({ folder, marker, name }) => {
        if (folder === 'drafts') {
          await (window.__packagedFixtureApi ?? window.api).saveDraft({ to: '', body: '', subject: marker })
        } else {
          const label = (await (window.__packagedFixtureApi ?? window.api).listLabels()).find((label) => label.name === name)
          const { delta } = window.__deliverMail({ subject: marker })
          await (window.__packagedFixtureApi ?? window.api).modifyLabels({
            kind: 'thread',
            id: delta.threads[0].id,
            addLabelIds: [label.id],
            removeLabelIds: ['INBOX']
          })
        }
        window.__releaseRefresh()
        window.__releaseRefresh = null
      }, { folder, marker, name })
      await destination.getByText(marker, { exact: true }).waitFor({ timeout: 5000 })
      assert(
        (await destinationRows.count()) === before + 1 &&
          (await destination.getByText(subject, { exact: true }).count()) === 1 &&
          (await destination.getByText('Launch checklist', { exact: true }).count()) === 0,
        `a sweep started in Inbox refreshes ${name} after switching views`,
        `the delayed sweep listed the wrong view after switching to ${name}`
      )
      await snapshot(page, `refresh-switch-${folder}`)
    }
    return 'refresh'
  })
  journeys.set('pagination', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox', exact: true })
    const rows = inbox.getByRole('listitem')
    const loadMore = inbox.getByRole('button', { name: 'Load more', exact: true })
    await inbox.getByText('Launch checklist', { exact: true }).waitFor({ timeout: 5000 })
    const firstPageSize = 30
    const deliveries = 64
    const initialRows = await rows.count()
    await page.evaluate((count) => {
      for (let i = 1; i <= count; i++) window.__deliverMail({ subject: `Paging thread ${i}` })
      window.__pushSync({ kind: 'reset' })
    }, deliveries)
    await loadMore.waitFor({ timeout: 5000 })

    // Capture page two before the resets, but keep the response in flight.
    await page.evaluate(() => {
      const listFolder = (window.__packagedFixtureApi ?? window.api).listFolder
      window.__paginationRequests = []
      ;(window.__packagedFixtureApi ?? window.api).listFolder = async (options) => {
        window.__paginationRequests.push(options)
        const result = await listFolder(options)
        if (window.__paginationRequests.length === 1) {
          await new Promise((resolve) => { window.__releasePage = resolve })
        }
        return result
      }
    })
    await activateLoadMore(page, inbox)
    await page.waitForFunction(() => Boolean(window.__releasePage))
    const arrival = 'Delivered during Load more'
    await page.evaluate((subject) => {
      window.__deliverMail({ subject, prepend: true })
      window.__pushSync({ kind: 'reset' })
      window.__pushSync({ kind: 'reset' })
    }, arrival)
    assert(
      (await inbox.getByText('Loading more...', { exact: true }).count()) === 1,
      'the second page is still in flight when the resets arrive',
      'the second page settled before the overlapping resets'
    )
    await page.evaluate(() => window.__releasePage())
    await inbox.getByText(arrival, { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await rows.count()) === firstPageSize * 2 + 1 &&
        (await page.evaluate(() => window.__paginationRequests.length)) === 2,
      'overlapping resets fold once after page two without losing either result',
      'overlapping resets did not coalesce or page two was lost'
    )
    await snapshot(page, 'pagination-overlap')

    const content = page.getByRole('region', { name: 'Email content' })
    for (const [number, action] of [[31, 'archive'], [32, 'delete']]) {
      const subject = `Paging thread ${number}`
      const row = inbox.getByRole('button').filter({
        has: page.getByText(subject, { exact: true })
      })
      // Avoid scrolling the list or triggering its pagination sentinel.
      await row.evaluate((button) => button.focus({ preventScroll: true }))
      await page.keyboard.press('Enter')
      await content.getByRole('heading', { name: subject, exact: true }).waitFor({ timeout: 5000 })
      await content.getByRole('button', { name: action, exact: true }).click()
      await row.waitFor({ state: 'detached', timeout: 5000 })
    }
    await activateLoadMore(page, inbox)
    await inbox.getByText(`Paging thread ${deliveries}`, { exact: true }).waitFor({ timeout: 5000 })
    for (let i = 1; i <= deliveries; i++) {
      const count = await inbox.getByText(`Paging thread ${i}`, { exact: true }).count()
      if (count !== (i === 31 || i === 32 ? 0 : 1)) {
        throw new Error(`ASSERT: wrong occurrence count for Paging thread ${i}: ${count}`)
      }
    }
    assert(
      (await rows.count()) === initialRows + deliveries - 1 && (await loadMore.count()) === 0,
      'a third page reaches every surviving thread exactly once after archive and delete',
      'archive or delete left missing, duplicated or extra pages'
    )
    const replay = await page.evaluate(() => window.__paginationRequests.slice(2))
    assert(
      replay.length === 3 &&
        replay[0].pageToken === undefined &&
        replay[1].pageToken === '30' &&
        replay[2].pageToken === '60' &&
        replay.every((request) => request.skipRowIds?.length === firstPageSize * 2 - 1),
      'replay starts at page one and skips metadata for all still-visible rows',
      'the continuation was not rebuilt or already-visible rows would be fetched again'
    )
    await snapshot(page, 'pagination')

    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts', exact: true })
    await drafts.getByText('Draft: Q4 planning notes', { exact: true }).waitFor({ timeout: 5000 })
    const draftFill = firstPageSize - (await drafts.getByRole('listitem').count()) - 1
    await page.evaluate(async ({ count, pageSize }) => {
      const save = (subject, threadId) =>
        (window.__packagedFixtureApi ?? window.api).saveDraft({ to: 'reader@example.com', body: '', subject, threadId })
      for (let i = 1; i <= count; i++) await save(`Pagination draft ${i}`)
      for (let i = 1; i <= 3; i++) await save(`Same-thread draft ${i}`, 'thread-launch')
      for (let i = 1; i <= pageSize; i++) await save(`Later draft ${i}`)
      window.__pushSync({ kind: 'reset' })
    }, { count: draftFill, pageSize: firstPageSize })
    await drafts.getByText('Same-thread draft 1', { exact: true }).waitFor({ timeout: 5000 })
    await activateLoadMore(page, drafts)
    await drafts.getByText(`Later draft ${firstPageSize - 2}`, { exact: true }).waitFor({
      timeout: 5000
    })
    assert(
      (await drafts.getByRole('listitem').count()) === firstPageSize * 2 &&
        (await drafts.getByText(`Later draft ${firstPageSize}`, { exact: true }).count()) === 0,
      'two of three draft pages are loaded before delete and send',
      'the draft mutations would not exercise continuation recovery'
    )
    for (let i = 1; i <= 3; i++) {
      assert(
        (await drafts.getByText(`Same-thread draft ${i}`, { exact: true }).count()) === 1,
        `draft ${i} is listed separately from others in the same conversation`,
        `pagination lost or duplicated draft ${i} in a shared conversation`
      )
    }
    await snapshot(page, 'pagination-drafts')
    const sentDraft = drafts.getByText('Same-thread draft 2', { exact: true })
    await sentDraft.click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 5000 })
    const sentDraftId = await page.evaluate(() =>
      window.__draftSaves.find((entry) => entry.subject === 'Same-thread draft 2').draftId
    )
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.', { exact: true }).waitFor({ timeout: 5000 })
    assert(
      (await sentDraft.count()) === 1,
      'the sent draft is still in the list during the confirmation',
      'the test did not reach the send confirmation window'
    )
    await activateLoadMore(page, drafts)
    const laterSubjects = Array.from({ length: firstPageSize }, (_, i) => `Later draft ${i + 1}`)
    await drafts.getByText(laterSubjects.at(-1), { exact: true }).waitFor({ timeout: 5000 })
    const laterCounts = await Promise.all(
      laterSubjects.map((subject) => drafts.getByText(subject, { exact: true }).count())
    )
    assert(
      laterCounts.every((count) => count === 1),
      'Load more finds each later draft once during the send confirmation',
      'sending a draft skipped or duplicated a surviving row'
    )
    await sentDraft.waitFor({ state: 'detached', timeout: 5000 })
    assert(
      (await page.evaluate(() => window.__sent[0]?.draftId)) === sentDraftId &&
        (await drafts.getByText('Same-thread draft 1', { exact: true }).count()) === 1 &&
        (await drafts.getByText('Same-thread draft 3', { exact: true }).count()) === 1,
      'the editor sends and prunes only the selected draft',
      'sending one draft used the wrong ID or removed a sibling'
    )
    await snapshot(page, 'pagination-draft-send')

    await drafts.getByText('Same-thread draft 3', { exact: true }).click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 5000 })
    const draftId = await page.evaluate(() =>
      window.__draftSaves.find((entry) => entry.subject === 'Same-thread draft 3').draftId
    )
    const confirmation = page.waitForEvent('dialog').then((dialog) => dialog.accept())
    await content.getByRole('button', { name: 'delete draft', exact: true }).click()
    await confirmation
    await page.waitForFunction(() => window.__draftDiscards.length === 1)
    assert(
      (await page.evaluate(() => window.__draftDiscards[0].draftId)) === draftId,
      'the editor deletes the draft opened from page two',
      'the editor deleted a different draft in the same conversation'
    )
    await drafts
      .getByText('Same-thread draft 3', { exact: true })
      .waitFor({ state: 'detached', timeout: 5000 })
    assert(
      (await drafts.getByText('Same-thread draft 1', { exact: true }).count()) === 1 &&
        (await drafts.getByRole('listitem').count()) === firstPageSize * 2,
      'deleting the selected draft leaves all surviving drafts listed',
      'deleting one draft changed other rows'
    )
    await snapshot(page, 'pagination-draft-discard')
    await page.evaluate(() => {
      const api = window.__packagedFixtureApi ?? window.api
      const list = api.listFolder
      window.__pageAfterArchive = []
      api.listFolder = async (options) => {
        const result = await list(options)
        if (options.folder === 'inbox' && options.pageToken && window.__pageAfterArchive.length === 0) {
          window.__pageAfterArchive = result.threads.map(({ subject }) => subject)
          await new Promise((resolve) => { window.__releaseArchivePage = resolve })
          throw new Error('Invalid page token')
        }
        return result
      }
    })
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    const archivedWhilePaging = inbox.getByText('Launch checklist', { exact: true })
    await archivedWhilePaging.waitFor({ timeout: 5000 })
    const pageControl = loadMore.or(inbox.getByText('Loading more...', { exact: true }))
    if (await pageControl.evaluate((el) => el.tagName === 'BUTTON', undefined, { timeout: 5000 })) {
      await activateLoadMore(page, inbox)
    }
    await page.waitForFunction(() => Boolean(window.__releaseArchivePage))
    const shiftedRow = await page.evaluate(async () => {
      const api = window.__packagedFixtureApi ?? window.api
      const { threads } = await api.listFolder({ folder: 'inbox', maxResults: 30 })
      const launch = threads.find(({ id }) => id === 'thread-launch')
      await api.modifyLabels({ kind: 'thread', id: launch.id, removeLabelIds: ['INBOX'] })
      window.__pushSync({
        kind: 'delta', historyId: 'remote-archive',
        threads: [{ ...launch, labelIds: [] }], deletedThreadIds: []
      })
      const page = await api.listFolder({ folder: 'inbox', maxResults: 30, pageToken: '30' })
      return page.threads.at(-1).subject
    })
    await archivedWhilePaging.waitFor({ state: 'detached', timeout: 5000 })
    assert(
      !(await page.evaluate((subject) => window.__pageAfterArchive.includes(subject), shiftedRow)),
      'the archive shifts a surviving thread into the held page',
      'the held response would not miss the shifted thread'
    )
    await page.evaluate(() => window.__releaseArchivePage())
    await inbox.getByText(shiftedRow, { exact: true }).waitFor({ timeout: 5000 }).catch(() => {
      throw new Error('ASSERT: the archive interrupted Load more without retrying the shifted page')
    })
    assert(
      (await rows.count()) === firstPageSize * 2,
      'a remote archive during Load more still completes page two without another request from the user',
      'the retry left a gap or duplicate rows across the archive boundary'
    )
    await snapshot(page, 'pagination-archive-during-load')
    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    await switchDuringPagination(page)
    return 'pagination'
  })
  journeys.set('signature', async () => {
    // The per-compose signature across all three surfaces: the stored text
    // is born from the first toggle in a fresh compose, the block rides
    // every send/autosave as ordinary body html, the draft round trip
    // preserves it and re-derives its pressed state on reopen, and the
    // reply surface appends it after the quote without touching it.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    // exact: the bar's neighbours are "Edit signature" and "Save
    // signature"; a substring name would match all three.
    const toggle = content.getByRole('button', { name: 'Signature', exact: true })
    await toggle.waitFor({ timeout: 10000 })
    assert(
      (await toggle.getAttribute('aria-pressed')) === 'false',
      'a fresh compose starts without the signature block',
      'fresh compose opened with a signature it has no stored text for'
    )
    assert(
      (await bodyTextOf(content.locator('.body-editor'))) === '',
      'empty storage auto-inserts nothing',
      'the fresh body holds text with no stored signature'
    )
    // First toggle with nothing stored: the inline editor opens instead of
    // inserting emptiness — the stored text is born here.
    await toggle.click()
    const signatureField = content.getByRole('textbox', { name: 'Signature' })
    await signatureField.waitFor({ timeout: 10000 })
    assert(
      true,
      'an empty stored signature opens the inline editor',
      'toggle did not open the editor'
    )
    await signatureField.fill('Ada Lovelace\nAnalytical Engine Dept.')
    await content.getByRole('button', { name: 'Save signature' }).click()
    // The panel closes back to the toggle row on save.
    await toggle.waitFor({ timeout: 10000 })
    assert(
      (await page.evaluate(() => window.localStorage.getItem('mailsy.signature'))) ===
        'Ada Lovelace\nAnalytical Engine Dept.',
      'the saved text persists in storage',
      'the stored signature did not persist'
    )
    // Toggle on: the block lands at the body's end and the button reads it.
    await toggle.click()
    assert(
      (await toggle.getAttribute('aria-pressed')) === 'true' &&
        (await bodyTextOf(content.locator('.body-editor'))).includes('Analytical Engine Dept.'),
      'the toggle inserts the signature block',
      'the signature block did not appear in the body'
    )
    // Typing above the signature leaves the block alone at the end.
    await content.locator('.body-editor').click()
    await content.locator('.body-editor').press('Control+Home')
    await content.locator('.body-editor').pressSequentially('Hello from Mailsy.')
    const freshBody = await bodyTextOf(content.locator('.body-editor'))
    assert(
      freshBody.includes('Hello from Mailsy.') && freshBody.includes('Analytical Engine Dept.'),
      `typing above the block keeps both (${freshBody.slice(0, 60)}…)`,
      'typing disturbed the signature block'
    )
    await snapshot(page, 'signature-compose')
    await toggle.click()
    assert(
      (await bodyTextOf(content.locator('.body-editor'))).includes('Hello from Mailsy.') &&
        !(await bodyTextOf(content.locator('.body-editor'))).includes('Analytical Engine Dept.'),
      'Ctrl+Home body text survives signature removal',
      'signature removal deleted the body text or retained the signature'
    )
    await snapshot(page, 'signature-removed')
    await toggle.click()
    await content.locator('.composerField input').first().fill('ada@example.com')
    await content.locator('.composerField input').nth(1).fill('Signature check')
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const freshSent = await page.evaluate(() => window.__sent)
    const signedRecord = freshSent[freshSent.length - 1]
    assert(
      freshSent.length === 1 &&
        signedRecord.subject === 'Signature check' &&
        String(signedRecord.body ?? '').includes('Analytical Engine Dept.') &&
        String(signedRecord.bodyHtml ?? '').includes('mailsy-signature'),
      `the send carries the signature in both forms (${JSON.stringify(signedRecord).slice(0, 100)}…)`,
      'the send lost the signature'
    )
    // A second fresh compose auto-inserts the stored signature: same
    // surface, no click on the toggle.
    await content.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await waitForPressed(
      toggle,
      'true',
      'a fresh compose auto-inserts the stored signature',
      'the auto-insert did not happen'
    )
    assert(
      (await bodyTextOf(content.locator('.body-editor'))).includes('Analytical Engine Dept.'),
      'the auto-inserted body carries the stored text',
      'the auto-insert left the body empty'
    )
    // The autosave round trip: the block rides the draft payload...
    const autoBody = content.getByRole('textbox', { name: 'Message', exact: true })
    const firstSignatureHtml = await autoBody.innerHTML()
    const signatureOffset = () => autoBody.evaluate((editor) =>
      editor.querySelector('.mailsy-signature').getBoundingClientRect().top -
        editor.getBoundingClientRect().top
    )
    const firstSignatureOffset = await signatureOffset()
    const savesBeforeRemoval = await page.evaluate(() => (window.__draftSaves ?? []).length)
    await toggle.click()
    assert(
      (await autoBody.innerHTML()) === '' &&
        (await autoBody.getAttribute('data-empty')) !== null &&
        (await autoBody.evaluate((editor) => getComputedStyle(editor, '::before').content)) ===
          '"Type your message..."',
      'removing an untouched signature restores the empty body and placeholder',
      'removing an untouched signature left body markup or hid the placeholder'
    )
    await page.waitForTimeout(2500)
    assert(
      (await page.evaluate(() => (window.__draftSaves ?? []).length)) === savesBeforeRemoval,
      'an untouched signature toggled off saves no draft after 2500ms',
      'an empty draft was autosaved after signature removal'
    )
    await snapshot(page, 'signature-empty')
    await toggle.click()
    assert(
      (await autoBody.innerHTML()) === firstSignatureHtml &&
        Math.abs((await signatureOffset()) - firstSignatureOffset) < 0.5,
      'off/on restores the original signature structure and position',
      'off/on added signature spacing or changed its structure'
    )
    await snapshot(page, 'signature-reinserted')
    await autoBody.pressSequentially('Normal typing stays.')
    await toggle.click()
    assert(
      (await bodyTextOf(autoBody)).includes('Normal typing stays.') &&
        !(await bodyTextOf(autoBody)).includes('Analytical Engine Dept.'),
      'normal typing survives signature removal',
      'signature removal deleted normally typed text or kept the signature'
    )
    await autoBody.evaluate((editor) => {
      editor.replaceChildren(document.createTextNode('A continuous'))
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    assert(
      await autoBody.evaluate((editor) =>
        editor.childNodes.length === 1 && editor.firstChild.nodeType === Node.TEXT_NODE
      ),
      'the sentence starts as a bare top-level text node',
      'the bare-text caret regression precondition was not met'
    )
    await toggle.click()
    await autoBody.pressSequentially(' sentence.')
    assert(
      await autoBody.evaluate((editor) =>
        editor.childNodes.length === 2 &&
        editor.firstChild.nodeName === 'DIV' &&
        editor.firstChild.textContent === 'A continuous sentence.' &&
        !editor.firstChild.querySelector('div, p, br') &&
        editor.lastChild.matches('.mailsy-signature')
      ),
      'continuing bare body text after signature insertion adds no DIV or BR to the sentence',
      'signature insertion split the body sentence across lines or typed inside the signature'
    )
    await snapshot(page, 'signature-bare-text')
    await toggle.click()
    await autoBody.evaluate((editor) => {
      const inline = document.createElement('strong')
      inline.textContent = 'Inline sentence'
      editor.replaceChildren(inline)
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    assert(
      await autoBody.evaluate((editor) =>
        editor.childNodes.length === 1 &&
        editor.firstChild.nodeType === Node.ELEMENT_NODE &&
        getComputedStyle(editor.firstChild).display === 'inline'
      ),
      'the inline sentence is a top-level formatted element',
      'the inline-element caret regression precondition was not met'
    )
    await toggle.click()
    await autoBody.pressSequentially(' continues.')
    assert(
      await autoBody.evaluate((editor) => {
        const body = editor.cloneNode(true)
        body.querySelector('.mailsy-signature').remove()
        return body.textContent === 'Inline sentence continues.' &&
          body.children.length === 1 && body.firstElementChild.tagName === 'DIV' &&
          !body.firstElementChild.querySelector('div, p, br')
      }),
      'continuing inline body content after signature insertion adds no line break',
      'signature insertion split inline body content across lines or entered the signature'
    )
    await snapshot(page, 'signature-inline-text')
    await toggle.click()
    const assertWhitespaceParity = async (body, signatureToggle, surface) => {
      const wasPressed = (await signatureToggle.getAttribute('aria-pressed')) === 'true'
      if (wasPressed) await signatureToggle.click()
      const originalHtml = await body.innerHTML()
      const quoteHtml = await body.locator('.gmail_quote_container').evaluateAll(
        (quotes) => quotes.map((quote) => quote.outerHTML)
      )
      for (const { html, text, visibleText, evidence } of [
        { html: '<b>Label:</b> ', text: 'Label: ', visibleText: 'Label: ', evidence: 'label-space' },
        { html: 'Line<br>  ', text: 'Line  ', visibleText: 'Line\n  ', evidence: 'br-indent' }
      ]) {
        await body.evaluate((editor, html) => {
          const quoteSelector = 'blockquote, .gmail_quote, .gmail_quote_container'
          const quotes = Array.from(editor.children).filter(
            (node) => node.matches(quoteSelector) || node.querySelector(quoteSelector)
          )
          const template = document.createElement('template')
          template.innerHTML = html
          editor.replaceChildren(...template.content.childNodes, ...quotes)
          editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
        }, html)
        await signatureToggle.click()
        await body.pressSequentially('Plain continuation.')
        for (const signed of [true, false]) {
          if (!signed) await signatureToggle.click()
          assert(
            (await body.locator('.mailsy-signature').count()) === (signed ? 1 : 0),
            `${surface}: ${evidence} signature block ${signed ? 'exists when on' : 'is gone after removal'}`,
            `${surface}: ${evidence} signature block did not match the toggle state`
          )
          assert(
            await body.evaluate((editor, { text, visibleText, quoteHtml }) => {
              const ownBody = editor.firstElementChild
              const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
              let continuation = walker.nextNode()
              while (continuation && !continuation.textContent.includes('Plain continuation.'))
                continuation = walker.nextNode()
              return ownBody.textContent === `${text}Plain continuation.` &&
                ownBody.innerText.trimEnd() === `${visibleText}Plain continuation.` &&
                JSON.stringify(Array.from(editor.querySelectorAll('.gmail_quote_container'),
                  (quote) => quote.outerHTML)) === JSON.stringify(quoteHtml) &&
                continuation && !continuation.parentElement.closest('b, strong, .mailsy-signature') &&
                Number(getComputedStyle(continuation.parentElement).fontWeight) < 600
            }, { text, visibleText, quoteHtml }),
            evidence === 'label-space'
              ? `${surface}: bold label + space stays spaced and unbold (${signed ? 'signature on' : 'signature removed'})`
              : `${surface}: BR + spaces preserves indentation (${signed ? 'signature on' : 'signature removed'})`,
            `${surface}: signature insertion skipped meaningful whitespace, inherited bold, or changed the quote`
          )
        }
        await snapshot(page, `signature-${surface}-${evidence}`)
      }
      await body.evaluate((editor, html) => {
        editor.innerHTML = html
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      }, originalHtml)
      if (wasPressed) await signatureToggle.click()
    }
    await assertWhitespaceParity(autoBody, toggle, 'compose')
    for (const enters of [1, 2]) {
      await autoBody.evaluate((editor) => {
        editor.replaceChildren(document.createTextNode('Line start'))
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      })
      await autoBody.press('Control+End')
      for (let i = 0; i < enters; i++) await autoBody.press('Enter')
      await toggle.click()
      await autoBody.pressSequentially('Line continuation.')
      await toggle.click()
      const text = (await bodyTextOf(autoBody)).trimEnd()
      assert(
        text === `Line start${'\n'.repeat(enters)}Line continuation.`,
        `${enters} Enter(s) before signature insertion preserves typed text on the new line`,
        `${enters} Enter(s) misplaced or deleted text after signature removal: ${JSON.stringify(text)}`
      )
      await snapshot(page, `signature-enter-${enters}`)
    }
    for (const breaks of [1, 2]) {
      await autoBody.evaluate((editor, count) => {
        const inline = document.createElement('strong')
        inline.append(document.createTextNode('Inline line'))
        for (let i = 0; i < count; i++) inline.append(document.createElement('br'))
        editor.replaceChildren(inline)
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      }, breaks)
      await toggle.click()
      await autoBody.pressSequentially('Inline continuation.')
      await toggle.click()
      const text = (await bodyTextOf(autoBody)).trimEnd()
      assert(
        text === 'Inline line\nInline continuation.',
        `inline content ending in ${breaks} BR(s) keeps continuation outside the removed signature`,
        `inline trailing BR(s) misplaced or deleted continuation: ${JSON.stringify(text)}`
      )
      await snapshot(page, `signature-inline-break-${breaks}`)
    }
    await autoBody.fill('')
    const pasteSignatureImage = () => autoBody.evaluate((editor) => {
      const bytes = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
        (character) => character.charCodeAt(0)
      )
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File([bytes], 'signature-image.png', { type: 'image/png' }))
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }))
    })
    await pasteSignatureImage()
    await autoBody.locator(':scope > img').waitFor({ timeout: 10000 })
    await toggle.click()
    await autoBody.pressSequentially('Typing after the image.')
    assert(
      await autoBody.evaluate((editor) => {
        const image = editor.querySelector('img')
        const signature = editor.querySelector('.mailsy-signature')
        const paragraph = Array.from(editor.children).find((node) =>
          node.textContent.includes('Typing after the image.')
        )
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        let continuation = walker.nextNode()
        while (continuation && !continuation.textContent.includes('Typing after the image.'))
          continuation = walker.nextNode()
        return paragraph && continuation && !paragraph.contains(signature) &&
          !signature.contains(paragraph) &&
          Boolean(image.compareDocumentPosition(continuation) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          Boolean(paragraph.compareDocumentPosition(signature) & Node.DOCUMENT_POSITION_FOLLOWING)
      }),
      'signature insertion types after a trailing inline image and before the signature',
      'signature insertion typed before the inline image or inside the signature'
    )
    await snapshot(page, 'signature-image-caret')
    await toggle.click()
    assert(
      (await bodyTextOf(autoBody)).includes('Typing after the image.') &&
        (await autoBody.locator('img').count()) === 1,
      'typing after a trailing image survives signature removal',
      'signature removal deleted text typed after the trailing image'
    )
    for (const { existingTail, wrapImage, evidence } of [
      { existingTail: '', evidence: 'empty-tail' },
      { existingTail: 'Existing tail.', evidence: 'sentence' },
      { existingTail: '', wrapImage: true, evidence: 'wrapped-whitespace' }
    ]) {
      await autoBody.evaluate((editor) => {
        editor.replaceChildren(document.createTextNode('Before image.'))
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      })
      await autoBody.press('Control+End')
      await pasteSignatureImage()
      await autoBody.locator(':scope > img').waitFor({ timeout: 10000 })
      assert(
        await autoBody.evaluate((editor) => {
          const tail = editor.querySelector('img').nextSibling
          return tail?.nodeType === Node.TEXT_NODE && tail.textContent === ''
        }),
        'pasting after bare text leaves the native empty trailing text node',
        'the empty-node image regression precondition was not met'
      )
      if (wrapImage) await autoBody.evaluate((editor) => {
        const image = editor.querySelector('img')
        const inline = document.createElement('span')
        image.replaceWith(inline)
        inline.append(image, document.createTextNode(' \t '))
        editor.append(document.createTextNode(' \t '))
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      })
      if (existingTail) await autoBody.pressSequentially(existingTail)
      await toggle.click()
      await autoBody.pressSequentially('Continued after toggling.')
      await toggle.click()
      assert(
        await autoBody.evaluate((editor, { tail, wrapImage }) => {
          const body = editor.firstElementChild
          const image = body.querySelector('img')
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
          let continuation = walker.nextNode()
          while (continuation && !continuation.textContent.includes('Continued after toggling.'))
            continuation = walker.nextNode()
          return editor.childNodes.length === 1 && body.tagName === 'DIV' &&
            !body.querySelector('div, p, br, .mailsy-signature') &&
            body.querySelectorAll('img').length === 1 &&
            body.textContent === `Before image.${wrapImage ? ' \t  \t ' : ''}${tail}Continued after toggling.` &&
            editor.innerText.trimEnd() === body.textContent.trimEnd() && continuation &&
            Boolean(image.compareDocumentPosition(continuation) & Node.DOCUMENT_POSITION_FOLLOWING)
        }, { tail: existingTail, wrapImage }),
        wrapImage
          ? 'image-containing inline content preserves trailing whitespace before subsequent typing'
          : existingTail
          ? 'text/image/text stays on one line and survives signature toggling'
          : 'text plus pasted image keeps subsequent typing in the body after signature removal',
        'signature toggling split the image sentence or deleted the continuation'
      )
      await snapshot(page, `signature-image-${evidence}`)
    }
    await toggle.click()
    const savesBefore = await page.evaluate(() => (window.__draftSaves ?? []).length)
    await content.locator('.composerField input').first().fill('brook@example.com')
    await content.locator('.composerField input').nth(1).fill('Draft with signature')
    await page.waitForFunction(
      (before) => (window.__draftSaves ?? []).length > before,
      savesBefore,
      { timeout: 10000 }
    )
    assert(
      true,
      'the signed compose autosaves with its block',
      'no autosave recorded the signature'
    )
    // ...and the Drafts folder restores it: the reopened editor re-derives
    // the pressed state from the stored html, not from the toggle.
    await page.getByRole('button', { name: 'Drafts' }).click()
    const drafts = page.getByRole('complementary', { name: 'Drafts' })
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Draft with signature', { exact: true }).first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    // The reopened editor derives the pressed state in its mount effect;
    // poll like every other post-mount flip.
    await waitForPressed(
      toggle,
      'true',
      'the reopened draft restores the signature and its pressed state',
      'the draft round trip lost the signature'
    )
    assert(
      (await bodyTextOf(content.locator('.body-editor'))).includes('Analytical Engine Dept.'),
      'the reopened draft body carries the signature text',
      'the draft round trip lost the signature text'
    )
    // Toggling off in the editor removes the block for this message only;
    // the stored text stays for the next compose.
    await toggle.click()
    assert(
      (await toggle.getAttribute('aria-pressed')) === 'false' &&
        !(await bodyTextOf(content.locator('.body-editor'))).includes('Analytical Engine Dept.'),
      'the editor toggle removes the block per message',
      'the removal did not clear the body'
    )
    assert(
      (await page.evaluate(() => window.localStorage.getItem('mailsy.signature'))) !== null,
      'the stored text survives the per-message removal',
      'per-message removal wiped the stored signature'
    )
    await toggle.click()
    await content.locator('.body-editor').pressSequentially(' Continuing the reopened draft.')
    assert(
      await content.locator('.body-editor').evaluate((editor) => {
        const signature = editor.querySelector('.mailsy-signature')
        const body = Array.from(editor.childNodes).find((node) =>
          node.textContent.includes('Continuing the reopened draft.')
        )
        return body && body !== signature && !signature.contains(body) &&
          Boolean(body.compareDocumentPosition(signature) & Node.DOCUMENT_POSITION_FOLLOWING)
      }),
      'reopened draft off/on typing stays in the body before the signature',
      'reopened draft typing after reinsertion entered the signature or left the body'
    )
    await snapshot(page, 'signature-draft-caret')
    await toggle.click()
    await assertWhitespaceParity(content.getByRole('textbox', { name: 'Message', exact: true }), toggle, 'reopened-draft')
    await content.getByRole('button', { name: 'Send', exact: true }).click()
    await content.getByText('Message sent.').waitFor({ timeout: 10000 })
    const draftSent = await page.evaluate(() => window.__sent)
    const unsignedRecord = draftSent[draftSent.length - 1]
    assert(
      draftSent.length === 2 &&
        unsignedRecord.subject === 'Draft with signature' &&
        !String(unsignedRecord.body ?? '').includes('Analytical Engine Dept.') &&
        !String(unsignedRecord.bodyHtml ?? '').includes('Analytical Engine Dept.'),
      `the unsigned draft send carries no signature (${JSON.stringify(unsignedRecord).slice(0, 100)}…)`,
      'the removal did not reach the send'
    )
    // The reply surface: the block appends after the quote, and the send
    // keeps the quote structure beside it.
    await page.getByRole('button', { name: 'Inbox' }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Launch checklist').first().click()
    await page.getByRole('button', { name: 'reply', exact: true }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'reply', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    const replyToggle = page.getByRole('button', { name: 'Signature', exact: true })
    assert(
      (await replyToggle.getAttribute('aria-pressed')) === 'false',
      'the reply composer starts without the block',
      'the reply opened with a signature it was never asked to add'
    )
    const originalQuote = await page.locator('.body-editor .gmail_quote_container').innerHTML()
    await replyToggle.click()
    assert(
      (await replyToggle.getAttribute('aria-pressed')) === 'true' &&
        (await bodyTextOf(page.locator('.body-editor'))).includes('Analytical Engine Dept.'),
      'the reply surface appends the signature',
      'the reply toggle did not insert'
    )
    await page.locator('.body-editor').pressSequentially('Replying with my signature.')
    assert(
      (await page.locator('.body-editor .gmail_quote_container').innerHTML()) === originalQuote &&
        !(await page.locator('.body-editor .mailsy-signature').textContent()).includes('Replying with my signature.') &&
        await page.locator('.body-editor').evaluate((editor) => {
          const ownBody = Array.from(editor.children).find((node) =>
            node.textContent.includes('Replying with my signature.')
          )
          return Boolean(ownBody &&
            (ownBody.compareDocumentPosition(editor.querySelector('.gmail_quote_container')) &
              Node.DOCUMENT_POSITION_FOLLOWING))
        }),
      'reply typing after signature insertion stays above and outside the unchanged quote',
      'reply typing entered the quote or signature, or landed below the quote'
    )
    await snapshot(page, 'signature-reply-caret')
    await assertWhitespaceParity(page.getByRole('textbox', { name: 'Message', exact: true }), replyToggle, 'reply')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('status').getByText('Message sent.').waitFor({ timeout: 10000 })
    const replySent = await page.evaluate(() => window.__sent)
    const replyRecord = replySent[replySent.length - 1]
    const replyHtml = String(replyRecord.bodyHtml ?? '')
    assert(
      replySent.length === 3 &&
        replyHtml.includes('gmail_quote_container') &&
        replyHtml.includes('mailsy-signature') &&
        replyHtml.includes('Analytical Engine Dept.'),
      `the reply keeps the quote and gains the block (${replyHtml.slice(0, 80)}…)`,
      'the reply lost the quote or the signature'
    )
    await snapshot(page, 'signature')
    await page.getByRole('button', { name: 'forward', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    const forwardQuote = await page.locator('.body-editor .gmail_quote_container').innerHTML()
    await page.getByRole('button', { name: 'Signature', exact: true }).click()
    await page.locator('.body-editor').pressSequentially('Forwarding outside the quote.')
    assert(
      (await page.locator('.body-editor .gmail_quote_container').innerHTML()) === forwardQuote &&
        !(await page.locator('.body-editor .mailsy-signature').textContent()).includes('Forwarding outside the quote.') &&
        (await bodyTextOf(page.locator('.body-editor'))).includes('Forwarding outside the quote.'),
      'forward typing after signature insertion leaves the quote and signature unchanged',
      'forward typing entered the quote or signature'
    )
    await snapshot(page, 'signature-forward-caret')
    await assertWhitespaceParity(page.getByRole('textbox', { name: 'Message', exact: true }), replyToggle, 'forward')
    return 'signature'
  })
  journeys.set('background-work', async () => {
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    await inbox.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })
    const rows = page.locator('.emails > li')

    await page.evaluate(() => {
      window.__queries = []
      const api = window.__packagedFixtureApi ?? window.api
      const listFolder = api.listFolder
      api.listFolder = (options = {}) => {
        if (options.q) window.__queries.push(options.q)
        return listFolder(options)
      }
    })
    const box = page.getByRole('searchbox', { name: 'Search emails' })
    await box.pressSequentially('b')
    await page.waitForTimeout(1500)
    assert(
      (await page.evaluate(() => window.__queries.length)) === 0,
      'a single settled character never reaches the boundary',
      'a one-character query was sent to the boundary'
    )
    await box.pressSequentially('udget', { delay: 120 })
    await page.getByText('Launch checklist', { exact: true }).waitFor({ state: 'detached', timeout: 10000 })
    await page.waitForTimeout(1000)
    const queries = await page.evaluate(() => window.__queries)
    assert(
      queries.length === 1 && queries[0] === 'budget',
      'six keystrokes settle into one boundary query for the whole word',
      `typing was not debounced into one query (${JSON.stringify(queries)})`
    )
    await snapshot(page, 'background-work-search')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await page.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })

    const before = await rows.count()
    await page.evaluate(() => {
      for (let n = 1; n <= 45; n++) window.__deliverMail({ subject: `Backlog mail ${n}` })
    })
    const folders = page.getByRole('navigation', { name: 'Mail folders' })
    await folders.getByRole('button', { name: 'Starred', exact: true }).click()
    await page.getByRole('complementary', { name: 'Starred' }).waitFor({ timeout: 10000 })
    await folders.getByRole('button', { name: 'Inbox', exact: true }).click()
    await page.waitForFunction(
      (count) => document.querySelectorAll('.emails > li').length > count,
      before,
      { timeout: 10000 }
    )
    const firstPage = await rows.count()
    assert(
      firstPage === 30,
      'the reopened inbox shows one page of 30 rows',
      `expected a 30-row first page, got ${firstPage}`
    )
    await rows.last().scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (total) => document.querySelectorAll('.emails > li').length === total,
      before + 45,
      { timeout: 10000 }
    )
    await inbox.getByText('Backlog mail 45', { exact: true }).first().waitFor({ timeout: 10000 })
    assert(
      (await page.getByRole('button', { name: 'Load more' }).count()) === 0,
      'scrolling to the end loads every remaining page with no click',
      'the list still offers Load more after scrolling to the end'
    )
    await snapshot(page, 'background-work-pagination')

    const rail = page.getByRole('navigation', { name: 'Mail folders' })
    const tipsActive = () => rail.evaluate((nav) => nav.classList.contains('tips-active'))
    await page.getByRole('searchbox', { name: 'Search emails' }).hover()
    await page.waitForFunction(
      () => !document.querySelector('.folder-rail')?.classList.contains('tips-active'),
      undefined,
      { timeout: 5000 }
    )
    await rail.getByRole('button', { name: 'Starred', exact: true }).hover()
    await page.waitForTimeout(200)
    assert(!(await tipsActive()), 'a rail tooltip stays hidden before the dwell', 'the tooltip showed with no dwell')
    await page.getByRole('searchbox', { name: 'Search emails' }).hover()
    await page.waitForTimeout(700)
    assert(!(await tipsActive()), 'leaving the rail early cancels the tooltip', 'the tooltip showed after the pointer left')
    await rail.getByRole('button', { name: 'Starred', exact: true }).hover()
    await page.waitForFunction(
      () => document.querySelector('.folder-rail')?.classList.contains('tips-active'),
      undefined,
      { timeout: 5000 }
    )
    assert(true, 'dwelling on a rail button shows its tooltip', 'the tooltip never showed')
    await snapshot(page, 'background-work-tooltip')
    await page.getByRole('searchbox', { name: 'Search emails' }).hover()
    await page.waitForFunction(
      () => !document.querySelector('.folder-rail')?.classList.contains('tips-active'),
      undefined,
      { timeout: 5000 }
    )
    assert(true, 'leaving the rail hides the tooltip', 'the tooltip stayed after the pointer left')

    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000))
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('brook@example.com')
    await content.locator('.composerField input').nth(1).fill('Closed before the autosave')
    await content.locator('.body-editor').fill('Typed and abandoned at once.')
    await page.clock.runFor(1)
    const pausedAt = await page.evaluate(() => Date.now())
    const savesBeforeClose = await page.evaluate(() => (window.__draftSaves ?? []).length)
    await rows.first().click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ state: 'detached', timeout: 10000 })
    await page.waitForFunction(() => (window.__draftSaves ?? []).length >= 1, undefined, { timeout: 5000 })
    const saves = await page.evaluate(() => window.__draftSaves)
    assert(
      (await page.evaluate(() => Date.now())) === pausedAt &&
        savesBeforeClose === 0 &&
        saves.length === 1 &&
        JSON.stringify(saves[0]).includes('Typed and abandoned at once.'),
      'closing a compose inside the autosave delay still saves it, once',
      `the abandoned compose was not saved exactly once (before close ${savesBeforeClose}, after ${saves.length})`
    )
    await page.clock.fastForward(1800)
    assert(
      (await page.evaluate(() => window.__draftSaves.length)) === 1 &&
        (await page.evaluate(() => (window.__sent ?? []).length)) === 0,
      'the cancelled autosave timer does not save a second time or send',
      'a second save or a send followed the closed compose'
    )
    await snapshot(page, 'background-work')
    return 'background-work'
  })
  const journey = journeys.get(FEATURE)
  if (!journey) throw new Error(`unknown feature: ${FEATURE}`)
  const executed = await journey()
  assert(executed === FEATURE,
    `executed journey ${executed} matches requested ${FEATURE}`,
    `requested journey ${FEATURE}, executed ${executed}`)
} catch (e) {
  log(`RESULT fail feature=${FEATURE} reason=${e instanceof Error ? e.message : String(e)}`)
  exitCode = e instanceof Error && e.message.startsWith('ASSERT') ? 1 : 2
} finally {
  if (EXECUTABLE && browser) {
    try {
      const proof = await browser.evaluate(() => globalThis.__packagedVerification)
      writeFileSync(resolve(ART, 'packaged.json'), JSON.stringify({ ...proof, entry }, null, 2))
      log(`packaged IPC: ${JSON.stringify(proof.counts)}`)
      if (proof.unexpectedNativeChannels.length) {
        exitCode = 2
        log(`RESULT fail feature=${FEATURE} reason=Unexpected native Gmail IPC in fixture mode: ${[...new Set(proof.unexpectedNativeChannels)].join(', ')}`)
      }
    } catch (error) {
      log(`infra: could not record final packaged IPC: ${error instanceof Error ? error.message : String(error)}`)
      if (exitCode === 0) {
        exitCode = 2
        log(`RESULT fail feature=${FEATURE} reason=final packaged IPC evidence unavailable`)
      }
    }
  }
  if (exitCode === 0) log(`RESULT pass feature=${FEATURE}`)
  writeFileSync(resolve(ART, `${FEATURE}.log`), logLines.join('\n') + '\n')
  await browser?.close()
}
process.exit(exitCode)
