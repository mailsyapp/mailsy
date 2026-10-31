import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 920 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.addInitScript(() => {
  window.api.listLabels = async () => ['ACTION NEEDED', 'HackClub!', 'GitHub'].map((name, i) => ({
    id: `label-scratch-${i}`, name, type: 'user',
    color: { background: '#4c72c4', text: '#ffffff' },
    messagesTotal: i, threadsTotal: i % 3
  }))
})
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'ACTION NEEDED', exact: true }).click()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).waitFor({ timeout: 10000 })
const t = await page.locator('.active-label-tile').boundingBox()
await page.screenshot({ path: process.env.PROBE_PNG, clip: { x: t.x - 12, y: t.y - 12, width: 80, height: 56 } })
await b.close()
