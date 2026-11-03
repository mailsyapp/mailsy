import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.addInitScript(() => {
  window.api.listLabels = async () => ['[Notion]', 'HackClub!', 'duck.com'].map((name, i) => ({
    id: `label-scratch-${i}`, name, type: 'user',
    color: { background: '#494aa2', text: '#ffffff' },
    messagesTotal: i, threadsTotal: i % 3
  }))
})
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.locator('.user-label-chips').screenshot({ path: process.env.PROBE_PNG })
// DOM truth: where does the remove button actually sit?
const box = await page.locator('.user-label-chip-remove').first().boundingBox()
const chip = await page.locator('.user-label-chip').first().boundingBox()
await b.close()
process.stdout.write(JSON.stringify({box, chip}, null, 1))
