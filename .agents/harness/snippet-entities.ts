// Harness journey step: Gmail's html-escaped snippets decode to plain text at the boundary.

import { decodeHtmlEntities } from '../../src/main/mail/entities.ts'
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import type { gmail_v1 } from 'googleapis'

assert.equal(
  decodeHtmlEntities('Your message wasn&#39;t delivered to test@example.com'),
  "Your message wasn't delivered to test@example.com",
  'decimal entities decode'
)
assert.equal(
  decodeHtmlEntities('invited to &quot;HQ/Shipwrights&quot; on &quot;Coolify&quot;'),
  'invited to "HQ/Shipwrights" on "Coolify"',
  'named quotes decode'
)
assert.equal(decodeHtmlEntities('Q&amp;A &lt;b&gt; &#x27;hex&#X27;'), "Q&A <b> 'hex'", 'amp, angle brackets and hex decode')
assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;', 'decoding is single-pass')
assert.equal(decodeHtmlEntities('a&nbsp;b &AMP; c'), 'a\u00a0b & c', 'nbsp and upper-case names decode')
assert.equal(
  decodeHtmlEntities('R&D, &unknown; &#0; &#xD800; &#1114112; & loose'),
  'R&D, &unknown; &#0; &#xD800; &#1114112; & loose',
  'unknown, invalid and bare ampersands stay as written'
)
assert.equal(decodeHtmlEntities('&#128512;'), '\u{1F600}', 'astral code points decode')

// The production mappers Gmail list, thread and message responses pass through.
const compiled = await build({
  stdin: {
    contents: "export { toEmailSummary, toEmailDetail, threadToSummary } from './src/main/mail/message'",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url))
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false
})
const mapperModule = { exports: {} as typeof import('../../src/main/mail/message.ts') }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  mapperModule,
  mapperModule.exports
)
const mappers = mapperModule.exports

const escaped = 'Can&#39;t &quot;ship&quot; Q&amp;A &amp;lt;b&amp;gt;'
const plain = 'Can\'t "ship" Q&A &lt;b&gt;'
const message = (snippet: string): gmail_v1.Schema$Message => ({
  id: 'm1',
  threadId: 't1',
  snippet,
  payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Hi' }], body: { data: '' } }
})
assert.equal(mappers.toEmailSummary('m1', message(escaped)).snippet, plain, 'list rows decode the Gmail snippet')
assert.equal(
  (await mappers.toEmailDetail({} as never, message(escaped))).snippet,
  plain,
  'opened messages decode the Gmail snippet'
)
assert.equal(
  mappers.threadToSummary({ id: 't1', snippet: 'unused', messages: [message('first'), message(escaped)] }).snippet,
  plain,
  'thread rows decode the last message snippet'
)
assert.equal(
  mappers.threadToSummary({ id: 't1', snippet: escaped, messages: [message('')] }).snippet,
  plain,
  'thread rows fall back to the decoded thread snippet'
)

console.log('snippet entities harness: ok')
