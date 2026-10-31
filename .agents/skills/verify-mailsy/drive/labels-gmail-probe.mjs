import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 920 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.addInitScript(() => {
  const names = ['[Notion]', 'HackClub!', 'duck.com', 'GitHub', 'Later', 'spam(spam@adityan.dev)', 'ACTION NEEDED', 'Snoozed by Mailsy']
  window.api.listLabels = async () =>
    names.map((name, i) => ({
      id: `label-scratch-${i}`,
      name,
      type: 'user',
      color: { background: '#4c72c4', text: '#ffffff' },
      messagesTotal: i,
      threadsTotal: i % 3
    }))
})
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4413}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(150)
// scroll the drawer to the labels section
const chips = page.locator('.user-label-chips')
await chips.scrollIntoViewIfNeeded()
await page.waitForTimeout(100)
await page.screenshot({ path: process.env.PROBE_PNG, clip: { x: 0, y: 480, width: 420, height: 440 } })
// geometry: dot inside icon column?
const geo = await page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
  const nav = document.querySelector('.folder-rail')
  const folderIcon = nav.querySelector('.folder-rail-button > svg')
  const dot = nav.querySelector('.user-label-chip-dot')
  return { folderIcon: box(folderIcon), dot: box(dot) }
})
console.log(JSON.stringify(geo, null, 1))
// select a label: chip click folds the drawer and the tile appears
await rail.getByRole('button', { name: 'ACTION NEEDED', exact: true }).click()
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).waitFor({ timeout: 10000 })
const tileGeo = await page.evaluate(() => {
  const el = document.querySelector('.active-label-tile')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bg: cs.backgroundColor, text: el.textContent }
})
await page.screenshot({ path: process.env.PROBE_PNG_TILE, clip: { x: 0, y: 0, width: 420, height: 200 } })
console.log(JSON.stringify({ tile: tileGeo }, null, 1))
await b.close()
