import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(120)
const out = await page.evaluate(() => {
  const btn = document.querySelector('.folder-rail-button')
  const cs = getComputedStyle(btn)
  const r = btn.getBoundingClientRect()
  return { h: r.height, csH: cs.height, display: cs.display, align: cs.alignItems, minH: cs.minHeight, maxH: cs.maxHeight, box: cs.boxSizing, padY: cs.paddingTop + '/' + cs.paddingBottom }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
