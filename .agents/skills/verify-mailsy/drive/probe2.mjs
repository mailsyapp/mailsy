import fs from 'node:fs'
const log = []
const L = (m) => { log.push(m); console.log(m) }
const browser = await (await import('playwright')).chromium.connectOverCDP('http://127.0.0.1:9222')
const page = await browser.contexts()[0].pages()[0]
const inbox = page.getByRole('complementary', { name: 'Inbox' })
await page.reload({ waitUntil: 'domcontentloaded' })
await inbox.waitFor({ timeout: 30000 })
await inbox.getByText('Document shared with you: "Aff Case: 3"', { exact: false }).first().click()
const btn = page.getByRole('region', { name: 'Email content' }).getByRole('button', { name: 'archive' })
await btn.waitFor({ timeout: 30000 })
await btn.click()
L('clicked archive')
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000)
  const state = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('section[aria-label="Email content"] button')]
    const b = btns.find((x) => x.textContent.trim() === 'archive')
    return b ? { disabled: b.disabled, alert: document.querySelector('p[role="alert"]')?.textContent ?? null } : null
  })
  L(`t+${i + 1}s button=${JSON.stringify(state)}`)
  if (state === null) { L('archive button gone (detail closed -> archived+pruned)'); break }
}
const server = await page.evaluate(async () => {
  const p = await window.api.listFolder({ folder: 'inbox', maxResults: 50 })
  return p.emails.some((e) => e.threadId === '1a14cb92a574b611')
})
L(`server still lists thread under INBOX: ${server}`)
if (server) {
  // leave server truth unchanged; nothing to restore
} 
await page.evaluate((id) => window.api.modifyLabels({ kind: 'thread', id, addLabelIds: ['INBOX'] }), '1a14cb92a574b611')
L('idempotent INBOX ensure done')
fs.writeFileSync('/tmp/probe2-log.txt', log.join('\n'))
process.exit(0)
