import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`
<div id="plain" contenteditable style="border:1px solid #000; height:80px"></div>
<div id="sep" contenteditable style="border:1px solid #000; height:80px"></div>
<script>document.execCommand('defaultParagraphSeparator', false, 'br')</script>
`)
const dump = await page.evaluate(async () => {
  // vanilla, default separator behavior:
  const a = document.getElementById('plain')
  a.focus()
  document.execCommand('insertText', false, 'a')
  a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) // no default action in synthetic; use execCommand instead:
  document.execCommand('insertLineBreak')
  document.execCommand('insertText', false, 'b')
  return a.innerHTML
})
console.log('vanilla after insertLineBreak path:', JSON.stringify(dump))
// backspace via real key event:
await page.locator('#plain').press('Backspace')
console.log('vanilla after Backspace:', await page.evaluate(() => document.getElementById('plain').innerHTML))
await page.locator('#plain').press('Backspace')
console.log('vanilla after Backspace2:', await page.evaluate(() => document.getElementById('plain').innerHTML))
await page.locator('#plain').press('Backspace')
console.log('vanilla after Backspace3:', await page.evaluate(() => document.getElementById('plain').innerHTML))

// native body insertion with paragraphSeparator=br, no handler at all:
const b = page.locator('#sep')
await b.click()
await page.keyboard.type('a', { delay: 20 })
await page.keyboard.press('Enter')
await page.keyboard.type('b', { delay: 20 })
console.log('sep native Enter:', await page.evaluate(() => document.getElementById('sep').innerHTML))
await b.press('Backspace')
console.log('sep after Backspace:', await page.evaluate(() => document.getElementById('sep').innerHTML))
await b.press('Backspace')
console.log('sep after Backspace2:', await page.evaluate(() => document.getElementById('sep').innerHTML))
await browser.close()
