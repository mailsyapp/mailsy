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
// DOM truth: the remove control must be absolute at the row's right edge now.
const out = await page.evaluate(() => {
  const chip = document.querySelector('.user-label-chip')
  const btn = document.querySelector('.user-label-chip-remove')
  const chipBox = chip.getBoundingClientRect()
  const btnBox = btn.getBoundingClientRect()
  const cs = getComputedStyle(btn)
  return { landed_right: Math.abs(btnBox.right - chipBox.right) < 60, centered: Math.abs((btnBox.top + btnBox.height / 2) - (chipBox.top + chipBox.height / 2)) < 1, position: cs.position, width: cs.width }
})
console.log(JSON.stringify(out))
await page.locator('.user-label-chip').first().hover()
await page.waitForTimeout(250)
await page.locator('.user-label-chips').screenshot({ path: process.env.PROBE_PNG })
await b.close()
