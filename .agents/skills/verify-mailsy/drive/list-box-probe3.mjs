import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
const before = await page.getByRole('complementary', { name: 'Inbox' }).boundingBox()
await rail.getByRole('button', { name: 'Labels', exact: true }).click()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
const after = await page.getByRole('complementary', { name: 'Inbox' }).boundingBox()
const boxes = await page.evaluate(() => {
  const q = (sel) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    return { top: r.top, height: r.height }
  }
  return {
    nav: q('.folder-rail'),
    chips: q('.user-label-chips'),
    grid: q('.mail-layout'),
    aside: q('.mail-layout aside, aside')
  }
})
console.log(JSON.stringify({ before, after, boxes }, null, 1))
await b.close()
