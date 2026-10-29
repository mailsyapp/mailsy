import fs from 'node:fs'
const browser = await (await import('playwright')).chromium.connectOverCDP('http://127.0.0.1:9222')
const page = await browser.contexts()[0].pages()[0]
const out = await page.evaluate(() => new Promise((resolve) => {
  const t = []
  t.push(document.querySelector('.error')?.textContent ?? null)
  t.push(document.querySelector('p[role="alert"]')?.textContent ?? null)
  t.push([...document.querySelectorAll('button')].map((b) => b.textContent.trim()).join('|'))
  t.push(document.querySelector('aside.emails, .email-sidebar')?.textContent.slice(0, 300) ?? null)
  resolve(t)
}))
fs.writeFileSync('/tmp/inspect-out.json', JSON.stringify(out, null, 2))
console.log(out)
process.exit(0)
