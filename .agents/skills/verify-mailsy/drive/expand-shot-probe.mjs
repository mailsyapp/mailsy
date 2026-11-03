// One-off scratch probe (per SKILL.md scratch rules): expanded-rail screenshot.
import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.goto(`http://127.0.0.1:${process.argv[2] ?? 4411}/`, { waitUntil: 'networkidle' })
const rail = page.getByRole('navigation', { name: 'Mail folders' })
await page.getByRole('complementary', { name: 'Inbox' }).waitFor({ timeout: 10000 })
await rail.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
await rail.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor({ timeout: 10000 })
await page.waitForTimeout(150)
await page.screenshot({ path: process.env.EXPAND_PNG })
await b.close()
