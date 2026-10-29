import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5213/', { waitUntil: 'domcontentloaded' })
try {
  const content = page.getByRole('region', { name: 'Email content' })
  await content.waitFor({ timeout: 20000 })
  await page.getByRole('region', { name: 'Email content' }).getByRole('button', { name: 'reply' }).waitFor({ timeout: 30000 }).catch(() => {})
  await page.getByText('Launch checklist').first().click()
  await page.waitForTimeout(2500)
  const btns = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Email content"] button')].map(b => b.textContent.trim()))
  console.log('DETAIL BUTTONS:', JSON.stringify(btns))
  const snooze = content.getByRole('button', { name: 'snooze', exact: true })
  console.log('snooze count:', await snooze.count(), 'visible:', await snooze.isVisible())
  console.log('snooze box:', JSON.stringify(await snooze.boundingBox()))
  console.log('PANE:', JSON.stringify(await page.evaluate(() => {
    const pane = document.querySelector('section[aria-label="Email content"]')
    return pane && { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight }
  })))
  await page.screenshot({ path: '/tmp/snooze-detail-open.png', fullPage: true })
} catch (e) { console.log('ERROR', e.message.slice(0, 300)); await page.screenshot({ path: '/tmp/snooze-boot.png', fullPage: true }) }
await browser.close()
