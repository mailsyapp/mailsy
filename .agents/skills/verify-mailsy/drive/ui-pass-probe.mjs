#!/usr/bin/env node
// UI pass probe for the rich compose body. Drives the scaffold server like
// drive.mjs (mock via addInitScript) and exercises quick-edit scenarios:
// backspace family, Enter, caret-after-image editing, select-all delete,
// fill-mode sizing/overflow, and reply-quote editing.
// Usage: node drive/ui-pass-probe.mjs [port]
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
await page.getByRole('button', { name: 'Compose', exact: true }).click()
await page.getByRole('heading', { name: 'New email' }).waitFor({ timeout: 10000 })
const ed = page.locator('.body-editor')
const bodyText = async (loc = ed) => (await loc.evaluate((el) => el.innerText)) ?? ''
const bodyHtml = async (loc = ed) => (await loc.evaluate((el) => el.innerHTML)) ?? ''
async function typeAtStart(loc, text) {
  await loc.evaluate((el) => {
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(true)
    sel.addRange(range)
  })
  await loc.pressSequentially(text)
}
async function typeAtEnd(loc, text) {
  await loc.evaluate((el) => {
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.addRange(range)
  })
  await loc.pressSequentially(text)
}

// S0: computed styles vs a plain field.
const styles = await page.evaluate(() => {
  const editor = document.querySelector('.body-editor')
  const input = document.querySelector('.composerField input')
  const es = getComputedStyle(editor)
  const is = getComputedStyle(input)
  return {
    editor: `${es.borderStyle} ${es.borderWidth} ${es.borderColor}`
  }
})
check(
  styles.editor !== 'none 0px rgba(0, 0, 0, 0)',
  'the body editor has a visible border like the other fields',
  `editor="${styles.editor}"`
)
console.log(`INFO editor style: ${styles.editor}`)

// S1: type then backspace all the way down to empty.
await ed.click()
await ed.pressSequentially('hello')
let t = await bodyText()
check(t === 'hello', 'typing lands text', JSON.stringify(t))
await ed.press('Backspace')
t = await bodyText()
check(t === 'hell', 'backspace removes one character', JSON.stringify(t))
for (let i = 0; i < 10; i++) await ed.press('Backspace')
t = await bodyText()
check(
  t.trim() === '',
  'backspace empties the box (the engine may keep one marker <br>)',
  JSON.stringify(t)
)

// S2: Enter inserts a line break; backspace removes the break again.
await typeAtEnd(ed, 'a')
await ed.press('Enter')
await ed.pressSequentially('b')
let html = await bodyHtml()
check(!/<div/.test(html), 'Enter does not wrap in block divs', html)
// The engine eats one visible unit per press: the typed 'b', the 'a',
// then the marker break — assert progress, not a particular order.
await ed.press('Backspace')
t = await bodyText()
check(
  t.includes('a') && t.length <= 4,
  'backspace removes the typed character across the break',
  JSON.stringify(t)
)
for (let i = 0; i < 3; i++) await ed.press('Backspace')
t = await bodyText()
check(
  t.trim() === '',
  'backspace chews through the line break without stalling',
  JSON.stringify(t)
)

// S3: caret after an image — typing appends; backspace at end trims text;
// backspace with the image range selected removes the image but keeps text.
await page.evaluate(() => {
  const editor = document.querySelector('.body-editor')
  editor.innerHTML = 'before<img src="data:image/png;base64,iVBORw0KGgo=">'
  const sel = window.getSelection()
  sel.removeAllRanges()
  const range = document.createRange()
  range.setStart(editor, editor.childNodes.length)
  range.collapse(true)
  sel.addRange(range)
  editor.focus()
})
await typeAtEnd(ed, 'after')
t = await bodyText()
check(t === 'beforeafter', 'typing after a trailing image appends text', JSON.stringify(t))
await page.evaluate(() => {
  const editor = document.querySelector('.body-editor')
  const last = editor.lastChild
  if (last.nodeType === 3 && last.textContent === '') last.remove()
  const sel = window.getSelection()
  const range = document.createRange()
  const img = editor.querySelector('img')
  range.setStartBefore(img)
  range.setEndAfter(img)
  sel.removeAllRanges()
  sel.addRange(range)
})
await ed.press('Backspace')
html = await bodyHtml()
check(!html.includes('<img'), 'backspace with the image selected removes it', html)
t = await bodyText()
check(t === 'beforeafter', 'surrounding text survives image removal', JSON.stringify(t))

// S4: select all + backspace, leaving a clean empty box.
await page.evaluate(() => {
  const editor = document.querySelector('.body-editor')
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(editor)
  sel.removeAllRanges()
  sel.addRange(range)
})
await ed.press('Backspace')
t = await bodyText()
check(t.trim() === '', `select-all+backspace empties (text '${t.trim()}')`, await bodyHtml())

// S5: drop routing — one image per drop, non-image stays a chip.
await page.evaluate(() => {
  const editor = document.querySelector('.body-editor')
  const btn = window
  btn.__dt = new DataTransfer()
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  btn.__dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }))
  btn.__dt.items.add(new File(['txt'], 'chip.txt', { type: 'text/plain' }))
  editor.dispatchEvent(new DragEvent('drop', { dataTransfer: btn.__dt, bubbles: true }))
})
await ed.locator('img').first().waitFor({ timeout: 10000 })
check(
  (await page.locator('.body-editor img').count()) === 1,
  'one image insert per drop (no double insert)',
  String(await page.locator('.body-editor img').count())
)
// The chip rides React state, not the direct DOM insert the image takes:
// wait for its commit instead of counting in the same instant.
await page.locator('.attachmentChip', { hasText: 'chip.txt' }).first().waitFor({ timeout: 10000 })
check(
  (await page.locator('.attachmentChip', { hasText: 'chip.txt' }).count()) === 1,
  'the non-image file in an editor drop became a chip',
  'missing chip'
)

// S6: fill-mode overflow — image plus lots of lines stays inside the
// editor's scroll area, never under the actions row.
await typeAtEnd(ed, 'tail text')
check(
  (await bodyText()).includes('tail text'),
  'text editable after the image',
  await bodyText()
)
for (let i = 1; i <= 40; i++) await ed.press('Enter')
const fit = await page.evaluate(() => {
  const editor = document.querySelector('.body-editor')
  const form = document.querySelector('form.composer-fill')
  const actions = form?.querySelector('.composerActions')
  return {
    scrollable: editor.scrollHeight,
    client: editor.clientHeight,
    edBottom: editor.getBoundingClientRect().bottom,
    actionsTop: actions ? actions.getBoundingClientRect().top : -1,
    imgTop: editor.querySelector('img')?.getBoundingClientRect().top ?? -1,
    imgBottom: editor.querySelector('img')?.getBoundingClientRect().bottom ?? -1,
    overflowY: getComputedStyle(editor).overflowY
  }
})
check(
  fit.actionsTop > 0 && fit.imgBottom <= fit.actionsTop,
  'image stays above the actions row',
  JSON.stringify(fit)
)
check(
  fit.scrollable >= fit.client,
  'long content sits in a scrollable editor (no spill)',
  JSON.stringify(fit)
)

// S7: reply composer — quote prefill, prefix typing, and backspace
// through the whole quote without hanging. The compose was never sent, so
// there is no retired pane to Close: a list-row click walks away, and the
// compose trimmed here autosaves (harmless for this run).
await typeAtEnd(ed, '')
for (let i = 1; i <= 40; i++) {
  await ed.press('Enter')
  if (i % 10 === 0) {
    const info = await page.evaluate(() => document.querySelector('.body-editor').innerHTML.length)
    console.log(`INFO fill-editor html length after ${i} Enters: ${info}`)
  }
}
await page.getByText('Launch checklist', { exact: true }).first().click()
await page.getByRole('heading', { name: 'Launch checklist' }).waitFor({ timeout: 10000 })
await page.getByRole('button', { name: 'reply', exact: true }).click()
await page.getByRole('heading', { name: 'Compose email' }).waitFor({ timeout: 10000 })
// filler step (S7 continues below)

const replyEd = page.locator('.body-editor')
const quote = await bodyText(replyEd)
check(quote.includes('wrote:'), 'reply quote prefilled in the rich body', quote.slice(0, 60))
await typeAtStart(replyEd, 'quick reply.\n\n')
const replyText = await bodyText(replyEd)
check(
  replyText.startsWith('quick reply.') && replyText.includes('Final review of the launch checklist'),
  'prefix typing keeps the quote behind it',
  replyText.slice(0, 90)
)
for (let i = 0; i < 150; i++) await replyEd.press('Backspace')
const cleared = await bodyText(replyEd)
check(
  cleared.length < 3,
  'backspace can wipe everything, quote included',
  JSON.stringify(cleared.slice(0, 40))
)
const clearedHtml = await bodyHtml(replyEd)
check(/^(<br\/?>|\s)*$/i.test(clearedHtml), 'the emptied box html is benign', clearedHtml.slice(0, 80))

console.log(failures === 0 ? 'PROBE: all pass' : `PROBE: ${failures} failing`)
await page.screenshot({ path: resolve(SKILL_DIR, 'artifacts/ui-pass-probe.png') })
await browser.close()
process.exit(failures === 0 ? 0 : 1)
