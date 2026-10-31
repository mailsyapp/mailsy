import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
const out = await page.evaluate(() => {
  const chip = document.querySelector('.user-label-chip')
  const btn = document.querySelector('.user-label-chip-remove')
  const cs = getComputedStyle(btn)
  const csc = getComputedStyle(chip)
  return {
    chipPosition: csc.position,
    chipWidth: csc.width,
    btnPosition: cs.position,
    btnTop: cs.top,
    btnRight: cs.right,
    btnZ: cs.zIndex,
    chipClass: chip.className
  }
})
process.stdout.write(JSON.stringify(out, null, 1))
await b.close()
