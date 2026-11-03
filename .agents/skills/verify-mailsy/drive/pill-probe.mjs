import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Labels', exact: true }).click()
const grab = () =>
  page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
    const nav = document.querySelector('.folder-rail')
    const active = nav.querySelector('.folder-rail-button.active')
    const toggle = nav.querySelector('.rail-toggle')
    const chip = nav.querySelector('.user-label-chip')
    const create = nav.querySelector('.user-label-create')
    const svgs = [...nav.querySelectorAll('.folder-rail-button > svg')].map(box)
    return {
      nav: box(nav), activeBtn: box(active), activeSvg: box(active.querySelector('svg')),
      toggleBtn: box(toggle), toggleSvg: box(toggle.querySelector('svg')),
      chip: box(chip), create: box(create),
      firstThreeSvgs: svgs.slice(0, 3)
    }
  })
const before = await grab()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(120)
const after = await grab()
console.log(JSON.stringify({ before, after }, null, 1))
await page.screenshot({ path: process.env.PROBE_PNG })
await b.close()
