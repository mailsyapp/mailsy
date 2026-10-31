import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 640, height: 720 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
const grab = () =>
  page.evaluate(() => {
    const f = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), ml: getComputedStyle(el).marginLeft } }
    const btn = document.querySelector('.folder-rail-button')
    return { svg: f(btn.querySelector('svg')), toggleSvg: f(document.querySelector('.rail-toggle > svg')) }
  })
const before = await grab()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(120)
const after = await grab()
console.log(JSON.stringify({ before, after }, null, 1))
await page.screenshot({ path: process.env.PROBE_PNG })
await b.close()
