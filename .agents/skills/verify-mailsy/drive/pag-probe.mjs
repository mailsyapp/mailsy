#!/usr/bin/env node
// Pagination probe: exercises the renderer's real pagination path
// (IntersectionObserver loadMore) against a synthetic 45-message mailbox
// injected through the boundary. Asserts page 1 only, then page 2 after a
// scroll, both numbers exact and duplicate-key warnings absent.
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdout } from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const MOCK = resolve(here, '..', 'fixtures/api-mock.js')
const PORT = process.argv[2] ?? '4317'
const log = (m) => stdout.write(`${m}\n`)

const mailbox = Array.from({ length: 45 }, (_, i) => ({
  id: `msg-p${i}`,
  threadId: `thread-p${i}`,
  from: `Pinger ${i} <p${i}@example.com>`,
  subject: `Pagination probe ${String(i).padStart(2, '0')}`,
  date: 'Sat, 17 Oct 2026 08:00:00 +0000',
  snippet: `probe body ${i}`,
  to: 'me@example.com',
  cc: '',
  bcc: '',
  replyTo: '',
  messageId: `<p${i}@example.com>`,
  references: '',
  bodyText: `probe body ${i}`,
  bodyHtml: `<p>probe body ${i}</p>`
}))
const PAGE_SIZE = 30

let browser
let page
let errors = []
try {
  browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addInitScript({ path: MOCK })
  await context.addInitScript((mailbox) => {
    const real = window.api.listFolder.bind(window.api)
    const pageSize = 30
    window.api.listFolder = async (options = {}) => {
      if (options.maxResults === 30 && options.q !== 'trigger-real-mock') {
        const all = mailbox
        const start = options.pageToken ? parseInt(options.pageToken, 10) || 0 : 0
        const slice = all.slice(start, start + pageSize)
        return { emails: slice, nextPageToken: start + pageSize < all.length ? String(start + pageSize) : null }
      }
      return real(options)
    }
  }, mailbox)
  page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
  const rows = page.locator('ul.emails li strong')
  await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(1500)
  log(`page1 rows=${JSON.stringify(await rows.allTextContents()).slice(0, 120)}...`)
  const first = await rows.count()
  if (first !== PAGE_SIZE) throw new Error(`ASSERT: page1 expected 30 rows, got ${first}`)
  log('pass: page 1 lists exactly 30 rows')
  // Scroll the sidebar to the bottom so the sentinel enters the 400px
  // rootMargin and the observer fires loadMore.
  await page.locator('.email-sidebar').evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await page.waitForFunction(() => document.querySelectorAll('ul.emails li').length === 45, null, { timeout: 10000 })
  const second = await rows.count()
  if (second !== 45) throw new Error(`ASSERT: after scroll expected 45 rows, got ${second}`)
  const unique = await page.evaluate(() => new Set(document.querySelectorAll('ul.emails li strong')).size)
  if (unique !== 45) throw new Error(`ASSERT: expected 45 unique rows, got ${unique}`)
  log('pass: scroll loads page 2; 45 unique rows, no duplicates')
  const dupErrors = errors.filter((e) => e.includes('same key'))
  if (dupErrors.length > 0) throw new Error(`ASSERT: ${dupErrors.length} duplicate-key warnings`)
  log('pass: no duplicate-key console errors across pagination')
  log('RESULT pass feature=pagination-probe')
} catch (e) {
  const bodyText = await page?.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => 'no page')
  log(`body: ${JSON.stringify(bodyText)}`)
  log(`errors: ${JSON.stringify(errors.slice(0, 4))}`)
  log(`RESULT fail pagination-probe ${e instanceof Error ? e.message : String(e)}`)
  await browser?.close()
  process.exit(1)
}
await browser?.close()
