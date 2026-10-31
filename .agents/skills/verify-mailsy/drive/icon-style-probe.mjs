import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
const grab = () =>
  page.evaluate(() => {
    const info = (el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), pl: cs.paddingLeft, ml: cs.marginLeft, jc: cs.justifyContent, wd: cs.width }
    }
    const nav = document.querySelector('.folder-rail')
    const toggle = document.querySelector('.rail-toggle')
    const first = document.querySelector('.folder-rail-button')
    return { nav: info(nav), toggleBtn: info(toggle), toggleSvg: info(toggle.querySelector('svg')), firstBtn: info(first), firstSvg: info(first.querySelector('svg')) }
  })
const before = await grab()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(120)
const after = await grab()
console.log(JSON.stringify({ before, after }, null, 1))
await b.close()
