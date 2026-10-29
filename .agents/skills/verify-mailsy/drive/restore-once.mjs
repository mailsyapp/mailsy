import { writeFileSync } from 'node:fs'
const log = []
const tryOrLog = async (fn, label) => {
  try { const r = await fn(); log.push(`${label}: ${JSON.stringify(r)}`); return r }
  catch (e) { log.push(`${label} FAILED: ${e instanceof Error ? e.message : String(e)}`); return null }
}
const browser = await (await import('playwright')).chromium.connectOverCDP('http://127.0.0.1:9222')
const page = await browser.contexts()[0].pages()[0]
const restore = await tryOrLog(() =>
  page.evaluate((id) => window.api.modifyLabels({ kind: 'thread', id, addLabelIds: ['INBOX'] }), '1a14cb92a574b611'),
  'restore modifyLabels')
const back = await tryOrLog(async () => {
  const p = await page.evaluate(async () => {
    const p = await window.api.listFolder({ folder: 'inbox', maxResults: 50 })
    return p.emails.map((e) => e.threadId)
  })
  return p.includes('1a14cb92a574b611')
}, 'thread back in live inbox')
log.push(`back: ${back}`)
writeFileSync(new URL('manual-archive-restore.log', import.meta.url), log.join('\n') + '\n')
console.log(log.join('\n'))
