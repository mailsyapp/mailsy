// Live-tier dead-grant probe, post-fix: attach to the running app, reload,
// and assert the renderer lands on the sign-in screen with a clean message
// and no dead token on disk.
import { chromium } from 'playwright'
import { writeFileSync, existsSync } from 'node:fs'

const log = []
const L = (m) => { log.push(m); console.log(m) }
const out = (f, s) => writeFileSync(new URL(f, import.meta.url), s)
try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Either the session-expiry message (transition through the failed list
  // call) or an immediate sign-in screen (no stored token at launch) is a
  // pass; raw invalid_grant text reaching this paragraph is not.
  const signInButton = page.getByRole('button', { name: 'Sign in with Google' })
  await signInButton.waitFor({ timeout: 30000 })
  L('pass: sign-in button offered (renderer flipped to signed-out)')

  const errorText = await page.locator('p.error').textContent({ timeout: 5000 }).catch(() => null)
  if (errorText === null) {
    L('note: no error paragraph; launch path had no stored token to reject')
  } else {
    L(`error paragraph: ${JSON.stringify(errorText.trim())}`)
    if (/invalid_grant/.test(errorText)) throw new Error('raw invalid_grant still reaches the UI')
    L('pass: error paragraph is the clean session-expiry sentence')
  }

  const tokenFile = process.env.HOME + '/Library/Application Support/mailsy/refresh-token.bin'
  if (errorText !== null) {
    if (existsSync(tokenFile)) throw new Error('dead token file survived alongside the expired-session error')
    L('pass: dead token file removed from disk by the boundary')
  }

  // The stale list must not outlive the flip.
  const rows = await page.locator('.emails li').count()
  if (rows > 0) throw new Error(`list still shows ${rows} rows after the flip`)
  L('pass: list cleared with the flip to signed-out')

  await page.screenshot({ path: new URL('dead-grant.png', import.meta.url).pathname })
  L('evidence: dead-grant.png')
  out('dead-grant.log', log.join('\n') + '\nRESULT pass live-tier feature=dead-grant\n')
  process.exit(0)
} catch (e) {
  log.push(e instanceof Error ? e.message : String(e))
  out('dead-grant.log', log.join('\n') + '\nRESULT fail live-tier feature=dead-grant\n')
  console.error('FAIL', e instanceof Error ? e.message : e)
  process.exit(1)
}
