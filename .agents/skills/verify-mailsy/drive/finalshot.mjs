import fs from 'node:fs'
const log = []
const L = (m) => { log.push(m); console.log(m) }
const browser = await (await import('playwright')).chromium.connectOverCDP('http://127.0.0.1:9222')
const page = await browser.contexts()[0].pages()[0]
try {
  await page.reload({ waitUntil: 'domcontentloaded' })
  const inbox = page.getByRole('complementary', { name: 'Inbox' })
  await inbox.waitFor({ timeout: 30000 })
  const first = await page.evaluate(() =>
    window.api.listFolder({ folder: 'inbox', maxResults: 1 }).then((p) => p.emails[0])
  )
  L(`target: ${first.threadId} ${JSON.stringify(first.subject)}`)
  await inbox.getByText(first.subject, { exact: false }).first().click()
  await page.getByRole('region', { name: 'Email content' }).getByRole('button', { name: 'archive' }).click()
  await inbox.getByText(first.subject, { exact: false }).first().waitFor({ state: 'detached', timeout: 30000 })
  L('pass: row detached after archive')
  const gone = await page.evaluate(async (id) => {
    const p = await window.api.listFolder({ folder: 'inbox', maxResults: 50 })
    return !p.emails.some((e) => e.threadId === id)
  }, first.threadId)
  L(`pass: server no longer lists thread under INBOX: ${gone}`)
  await page.screenshot({ path: new URL('manual-archive.png', import.meta.url).pathname })
  L('evidence: manual-archive.png (archived state)')
  await page.evaluate((id) => window.api.modifyLabels({ kind: 'thread', id, addLabelIds: ['INBOX'] }), first.threadId)
  const back = await page.evaluate(async (id) => {
    const p = await window.api.listFolder({ folder: 'inbox', maxResults: 50 })
    return p.emails.some((e) => e.threadId === id)
  }, first.threadId)
  L(`pass: thread restored under INBOX after ensure: ${back}`)
  if (!back) throw new Error('restore failed')
  fs.appendFileSync(new URL('manual-archive.log', import.meta.url), 'final cycle: ' + log.join(' | ') + '\n')
  process.exit(0)
} catch (e) {
  console.error('FAIL', e instanceof Error ? e.message : e)
  fs.appendFileSync(new URL('manual-archive.log', import.meta.url), 'final cycle FAILED: ' + log.join(' | ') + '\n')
  process.exit(1)
}
