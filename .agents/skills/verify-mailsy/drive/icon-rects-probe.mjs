import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
const grab = () =>
  page.evaluate(() => {
    const svgRect = (sel) => {
      const el = document.querySelector(sel)
      const r = el.getBoundingClientRect()
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
    }
    return {
      inboxSvg: svgRect('.folder-rail-button > svg'),
      toggleSvg: svgRect('.rail-toggle > svg'),
    }
  })
const before = await grab()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(120)
const after = await grab()
// also the create svg while expanded
const createSvg = await page.evaluate(() => {
  const el = document.querySelector('.user-label-create > svg, .user-label-chips [data-tip] > svg')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cls: el.parentElement.className }
})
console.log(JSON.stringify({ before, after, createSvg }, null, 1))
await b.close()
