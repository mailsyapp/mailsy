// Harness journey step: Gmail's html-escaped snippets decode to plain text at the boundary.

import { decodeHtmlEntities } from '../../src/main/mail/entities.ts'
import assert from 'node:assert'

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

console.log('snippet entities harness: ok')
