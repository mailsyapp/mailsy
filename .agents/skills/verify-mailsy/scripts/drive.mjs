#!/usr/bin/env node
// Driver for verify-mailsy. Drives the real renderer through the UI only.
// Usage: node scripts/drive.mjs --feature <id> --run-id <id> --port <n> [--signed-out]
// Exit: 0 pass, 1 journey failure (reason in log), 2 infra failure.
import { chromium } from 'playwright'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

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
if (!FEATURE || !RUN_ID || !PORT) {
  console.error('usage: drive.mjs --feature <id> --run-id <id> --port <n> [--signed-out]')
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
const logLines = [`command: drive.mjs --feature ${FEATURE} --run-id ${RUN_ID} --port ${PORT}${SIGNED_OUT ? ' --signed-out' : ''}`, `entry: http://127.0.0.1:${PORT}/`]
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

async function snapshot(page, name) {
  const snap = await page.locator('body').ariaSnapshot()
  writeFileSync(resolve(ART, `${name}.aria.txt`), `feature: ${FEATURE}\nentry: http://127.0.0.1:${PORT}/\n${snap}\n`)
  await page.screenshot({ path: resolve(ART, `${name}.png`) })
  log(`evidence: ${name}.aria.txt + ${name}.png`)
}

let browser
try {
  browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addInitScript({ path: MOCK })
  if (SIGNED_OUT) {
    await context.addInitScript(() => {
      window.api.isSignedIn = async () => false
      window.api.signIn = async () => { window.__signInClicked = true }
    })
  }
  const page = await context.newPage()
  // Fast-forwarding journeys need fake timers installed before the app's
  // intervals exist; other features run on real time, unchanged.
  if (FEATURE === 'snooze-emulation') await page.clock.install()
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })

  if (FEATURE === 'sign-in') {
    const btn = page.getByRole('button', { name: 'Sign in with Google' })
    await btn.waitFor({ timeout: 10000 })
    assert(true, 'signed-out state offers "Sign in with Google"', 'sign-in button missing')
    await btn.click()
    assert(await page.evaluate(() => window.__signInClicked === true), 'click invokes sign-in bridge', 'sign-in bridge not invoked')
    await snapshot(page, 'sign-in')
  } else if (FEATURE === 'sign-out') {
    // Fresh page load, signed in by default (no --signed-out): the inbox
    // must be on screen so the flip has mail state to clear.
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().waitFor({ timeout: 10000 })
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await signOut.waitFor({ timeout: 10000 })
    assert(true, 'signed-in state offers the "Sign out" button', 'Sign out button missing while signed in')
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
  } else if (FEATURE === 'inbox') {
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
  } else if (FEATURE === 'search') {
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
    assert(true, 'search "budget" surfaces the budget draft and filters the rest', 'filtering did not happen')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await page.getByText('Launch checklist').first().waitFor({ timeout: 10000 })
    assert(true, 'clear restores the full inbox', 'inbox not restored after clear')
    await snapshot(page, 'search')
  } else if (FEATURE === 'read-thread') {
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
  } else if (FEATURE === 'compose-send') {
    await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist').first().click()
    await page.getByRole('button', { name: 'reply', exact: true }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'reply', exact: true }).click()
    await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
    assert(true, 'reply opens composer', 'composer did not open')
    const toValue = await page.locator('.composerField input').first().inputValue()
    assert(toValue.includes('ada@example.com'), `reply To prefilled (${toValue})`, 'reply To not prefilled')
    await page.locator('.composerField textarea').evaluate((el) => el.setSelectionRange(0, 0))
    await page.locator('.composerField textarea').pressSequentially('On it — reviewing today.\n\n')
    // The quote text stays in the composer body; deleting it would point the
    // splice in formatDraftHtml at nothing and send a quote-less html part.
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
    await page.locator('.composerField textarea').evaluate((el) => el.setSelectionRange(0, 0))
    await page.locator('.composerField textarea').pressSequentially('forwarding for the record.\n\n')
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
  } else if (FEATURE === 'compose-new') {
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
    await content.locator('.composerField textarea').fill('First message sent from the fresh composer.\nTwo lines.')
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
  } else if (FEATURE === 'drafts') {
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
  } else if (FEATURE === 'delete-draft') {
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
    await content.locator('.composerField textarea').fill('A draft worth deleting.')
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
    const acceptEditor = page.waitForEvent('dialog').then((d) => d.accept())
    // Scoped to the pane: the live row behind this editor also renders a
    // "delete draft" button in the list.
    await content.getByRole('button', { name: 'delete draft' }).click()
    await acceptEditor
    await content
      .getByRole('heading', { name: 'Draft', exact: true })
      .waitFor({ state: 'detached', timeout: 10000 })
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
    await snapshot(page, 'delete-draft')
  } else if (FEATURE === 'draft-autosave') {
    // Fresh compose: type, let the boundary record the autosave, then close
    // the pane without Send or Cancel — the accidental-close path.
    const inbox = page.getByRole('complementary', { name: 'Inbox' })
    await inbox.waitFor({ timeout: 10000 })
    const content = page.getByRole('region', { name: 'Email content' })
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await content.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
    await content.locator('.composerField input').first().fill('brook@example.com')
    await content.locator('.composerField input').nth(1).fill('Autosaved while typing')
    await content.locator('.composerField textarea').fill('Half a thought saved before anything was sent.')
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
    const restoredBody = await content.locator('.composerField textarea').inputValue()
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
    await content.locator('.composerField textarea').evaluate((el) => {
      el.setSelectionRange(el.value.length, el.value.length)
    })
    await content.locator('.composerField textarea').pressSequentially('\nAdding the Q4 agenda line.')
    await page.waitForFunction(
      () => (window.__draftSaves ?? []).length >= 3 && window.__draftSaves[2]?.draftId === 'draft-1',
      undefined,
      { timeout: 10000 }
    )
    assert(true, 'draft edit autosaved on the stored draft id', 'draft edit did not autosave')
    await page.getByRole('button', { name: 'Inbox' }).click()
    await inbox.waitFor({ timeout: 10000 })
    await page.getByText('Launch checklist', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Drafts' }).click()
    await drafts.waitFor({ timeout: 10000 })
    await drafts.getByText('Draft: Q4 planning notes').first().click()
    await content.getByRole('heading', { name: 'Draft', exact: true }).waitFor({ timeout: 10000 })
    const reopenedBody = await content.locator('.composerField textarea').inputValue()
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
  } else if (FEATURE === 'delete-to-trash') {
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
  } else if (FEATURE === 'archive') {
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
  } else if (FEATURE === 'mark-read') {
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
  } else if (FEATURE === 'starred') {
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
  } else if (FEATURE === 'all-mail') {
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
  } else if (FEATURE === 'reply-all') {
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
    await page.locator('.composerField textarea').evaluate((el) => el.setSelectionRange(0, 0))
    await page.locator('.composerField textarea').pressSequentially('Agenda updated, see notes.\n\n')
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
  } else if (FEATURE === 'cc-bcc') {
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
    await content.locator('.composer').getByLabel('Message').fill('Carbon recipients ride the send.')
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
  } else if (FEATURE === 'spam') {
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
  } else if (FEATURE === 'snooze') {
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
  } else if (FEATURE === 'snooze-emulation') {
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
    await page.clock.fastForward(48 * 60 * 60 * 1000)
    await page.getByRole('button', { name: 'Inbox', exact: true }).click()
    await inbox.waitFor({ timeout: 10000 })
    await inbox
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ timeout: 10000 })
    assert(true, 'wake returned the thread to the Inbox', 'thread missing from the Inbox after wake')
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
    await snoozed
      .getByText('Launch checklist', { exact: true })
      .first()
      .click()
    await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
    await content.getByRole('button', { name: 'unsnooze', exact: true }).click()
    await snoozed
      .getByText('Launch checklist', { exact: true })
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
    const detailRestoreMods = await page.evaluate(() => window.__mods)
    assert(
      detailRestoreMods.length === 6 &&
        detailRestoreMods[5].kind === 'thread' &&
        detailRestoreMods[5].id === 'thread-launch' &&
        (detailRestoreMods[5].addLabelIds ?? []).includes('INBOX') &&
        (detailRestoreMods[5].removeLabelIds ?? []).includes('Snoozed by Mailsy'),
      `detail restore pair recorded ${JSON.stringify(detailRestoreMods)}`,
      'detail restore side effect not recorded'
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
  } else if (FEATURE === 'category-views') {
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
  } else if (FEATURE === 'unread-bold') {
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
  } else if (FEATURE === 'sidebar') {
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
  } else if (FEATURE === 'sidebar-expanded') {
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
    await rail.getByRole('button', { name: 'New label', exact: true }).click()
    await rail.getByRole('textbox', { name: 'Label name' }).waitFor({ timeout: 10000 })
    log('pass: New label opens its inline form while expanded')
    await rail.getByRole('textbox', { name: 'Label name' }).press('Escape')
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
  } else if (FEATURE === 'labels') {
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
  } else if (FEATURE === 'refresh') {
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
    await snapshot(page, 'refresh')
  } else {
    throw new Error(`unknown feature: ${FEATURE}`)
  }
  log(`RESULT pass feature=${FEATURE}`)
} catch (e) {
  log(`RESULT fail feature=${FEATURE} reason=${e instanceof Error ? e.message : String(e)}`)
  writeFileSync(resolve(ART, `${FEATURE}.log`), logLines.join('\n') + '\n')
  await browser?.close()
  process.exit(e instanceof Error && e.message.startsWith('ASSERT') ? 1 : 2)
}
writeFileSync(resolve(ART, `${FEATURE}.log`), logLines.join('\n') + '\n')
await browser?.close()
process.exit(0)
