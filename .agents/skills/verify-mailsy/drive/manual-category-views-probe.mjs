// Manual-tier live probe for the category views: real Electron + real Gmail
// through CDP.
// The Important view and the Social view load through the real
// labelIds:['IMPORTANT'] / labelIds:['CATEGORY_SOCIAL'] listing. The probe
// fails loudly if the API rejects a system-label filter, which would be the
// signal to move the views onto the q:'category:...' query path like the
// Snoozed view. Listing volume is held to one list + five detail gets per
// view because the shared account runs on a tight per-minute quota.
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const RUN_ID = process.env.RUN_ID ?? 'no-run-id'
const log = []
const L = (m) => { log.push(m); console.log(m) }
const ART = new URL(`../../artifacts/${RUN_ID}/`, import.meta.url).pathname
mkdirSync(ART, { recursive: true })
try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const page = await browser.contexts()[0].pages()[0]
  await page.waitForLoadState('domcontentloaded')

  const signedOut = await page.getByRole('button', { name: 'Sign in with Google' }).count()
  if (signedOut > 0) throw new Error('NOT SIGNED IN: live tier needs the stored refresh token to work')

  // The live boundary answers each view's real labelIds filter or errors.
  for (const [rail, folder] of [
    ['Important', 'important'],
    ['Social', 'social']
  ]) {
    await page.getByRole('button', { name: rail, exact: true }).click()
    await page.getByRole('complementary', { name: rail, exact: true }).waitFor({ timeout: 30000 })
    const listing = await page.evaluate((f) =>
      window.api.listFolder({ folder: f, maxResults: 5 }).then(
        (p) => p.threads.map((t) => t.subject), (e) => `ERROR ${e.message}`), folder)
    if (typeof listing === 'string' && listing.startsWith('ERROR')) {
      throw new Error(`${rail} listing rejected: ${listing}`)
    }
    L(`pass: real Gmail answers labelIds listing for ${rail} with ${listing.length} thread(s)`)
    L(`${rail} first subjects: ${listing.map((s) => JSON.stringify(s).slice(0, 50)).join('; ')}`)
  }

  await page.screenshot({ path: `${ART}/manual-category-views.png` })
  L(`evidence: ${ART}/manual-category-views.png`)
  writeFileSync(new URL('manual-category-views.log', import.meta.url), log.join('\n') + '\nRESULT pass live-tier feature=manual-category-views\n')
  process.exit(0)
} catch (e) {
  L(`fail: ${e instanceof Error ? e.message : String(e)}`)
  writeFileSync(new URL('manual-category-views.log', import.meta.url), log.join('\n') + '\nRESULT fail live-tier feature=manual-category-views\n')
  process.exit(1)
}
