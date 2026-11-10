// One-off scratch probe: high-DPI screenshot of the inbox with a sample
// email open. Same UI path as the read-thread journey, but rendered at
// deviceScaleFactor 2 for crisp output. Not part of the maintained surface.
// Usage: node scripts/hires-shot.mjs --port <n> --out <path>
import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const MOCK = resolve(here, '..', 'fixtures/api-mock.js')

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? def : (process.argv[i + 1] ?? def)
}
const PORT = arg('port', '4317')
const OUT = arg('out', 'hires.png')

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
})
await context.addInitScript({ path: MOCK })
const page = await context.newPage()
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })

await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await page.getByText('Deploy window').first().click()
const content = page.getByRole('region', { name: 'Email content' })
await content.getByText('2 messages in conversation').waitFor({ timeout: 10000 })
await content.getByText('Can we move the deploy window to Thursday?').first().waitFor({ timeout: 10000 })
await page.waitForTimeout(300)

await page.screenshot({ path: OUT, fullPage: true })
console.log(`saved: ${OUT}`)
await browser.close()
