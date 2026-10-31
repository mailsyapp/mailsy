// One-off scratch probe: expanded rail with a many-label mailbox, to see
// the chip remove affordance where it actually renders.
import { chromium } from 'playwright'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript({ path: new URL('../fixtures/api-mock.js', import.meta.url).pathname })
await page.addInitScript(() => {
  const colors = [
    { backgroundColor: '#494aa2', textColor: '#ffffff' },
    { backgroundColor: '#cf8837', textColor: '#ffffff' }
  ]
  const names = ['[Notion]', 'HackClub!', 'duck.com', 'GitHub', 'Later', 'spam(spam@adityan.dev)', 'ACTION NEEDED', 'Snoozed by Mailsy']
  window.api.listLabels = async () =>
    names.map((name, i) => ({
      id: `label-scratch-${i}`,
      name,
      type: 'user',
      color: { background: colors[i % 2].backgroundColor, text: colors[i % 2].textColor },
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
await page.screenshot({ path: process.env.PROBE_PNG })
await b.close()
