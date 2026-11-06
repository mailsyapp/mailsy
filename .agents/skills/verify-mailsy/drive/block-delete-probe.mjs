import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`
<div id="e" contenteditable style="border:1px solid #000; height:120px; white-space: pre-wrap;">a<div class="gmail_quote"><div class="gmail_attr">On Tue, wrote:<br></div><blockquote>hello there body</blockquote></div></div>
<pre id="log"></pre>
`)
const log = []
const snap = () => page.evaluate(() => document.getElementById('e').innerHTML)
await page.locator('#e').click()
// caret to very start
await page.evaluate(() => {
  const ed = document.getElementById('e')
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(ed, 0)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
})
for (let i = 0; i < 12; i++) {
  await page.locator('#e').press('Backspace')
  log.push(`${i}: ${(await snap()).slice(0, 60)}`)
}
console.log(log.join('\n'))
await browser.close()
