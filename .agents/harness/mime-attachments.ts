// Harness journey step: buildRawMessage with attachments produces correct MIME.

import { base64UrlToBuffer, buildRawMessage, collectBodies } from '../../src/main/mail/mime.ts'
import assert from 'node:assert'

const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x77, 0x21, 0x00])
const raw = await buildRawMessage('me@example.com', {
  to: 'you@example.com',
  subject: 'attach test',
  body: 'body text',
  attachments: [{ filename: 'data.bin', size: bytes.length, data: bytes.toString('base64') }]
})

const mime = base64UrlToBuffer(raw).toString('utf-8')
assert.match(mime, /multipart\/mixed/, 'attachments force a multipart/mixed message')
assert.match(mime, /Content-Disposition: attachment; filename=data\.bin/, 'part is a named attachment')

// Round trip the same walk Gmail's full format goes through.
const fakePart = {
  mimeType: 'multipart/mixed',
  headers: [],
  body: { size: 0, attachmentId: 'top' },
  parts: [
    {
      mimeType: 'text/plain',
      headers: [],
      body: { data: Buffer.from('body text').toString('base64url'), attachmentId: 'a1', size: 9 }
    },
    {
      mimeType: 'application/octet-stream',
      filename: 'data.bin',
      headers: [{ name: 'Content-Disposition', value: 'attachment; filename="data.bin"' }],
      body: { data: bytes.toString('base64url'), attachmentId: 'a2', size: bytes.length * 2 }
    },
    {
      mimeType: 'image/png',
      filename: 'logo.png',
      headers: [{ name: 'Content-ID', value: '<logo@inline>' }],
      body: { data: 'imgdata', attachmentId: 'a3', size: 7 }
    }
  ]
}

const out = { text: '', html: '', inlineImages: [], attachments: [] }
collectBodies(fakePart, out)

assert.equal(out.text, 'body text', 'plain body survives the walk')
assert.equal(out.attachments.length, 1, 'only the named non-inline part lists')
assert.equal(out.attachments[0].attachmentId, 'a2')
assert.equal(out.attachments[0].size, bytes.length * 2)
assert.equal(out.inlineImages.length, 1, 'cid image stays inline, never an attachment ref')

// No attachments means no multipart and no empty attachments block.
const plain = await buildRawMessage('me@example.com', {
  to: 'you@example.com',
  subject: 'plain',
  body: 'hi'
})
assert.equal(Buffer.from(base64UrlToBuffer(plain)).toString('utf-8').includes('multipart/mixed'), false, 'plain message stays single part')

// Inline body images: a composed rich body carries data URLs; the raw
// message carries them as cid parts grouped with the html (multipart/
// related), the text fallback unchanged.
const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const inline = await buildRawMessage('me@example.com', {
  to: 'you@example.com',
  subject: 'inline test',
  body: 'around the picture',
  bodyHtml: '<p>before</p><img src="data:image/png;base64,' + imageBytes.toString('base64') + '"><p>after</p>'
})
const inlineMime = base64UrlToBuffer(inline).toString('utf-8')
assert.match(inlineMime, /multipart\/related/, 'inline images build a related group with the html')
assert.match(inlineMime, /Content-ID: <inline-1@mailsy>/, 'the inline image gets its cid')
assert.match(
  inlineMime,
  /Content-Type: text\/html[\s\S]*cid:inline-1@mailsy[\s\S]*Content-Type: image\/png/,
  'the html references the image part by cid'
)
assert.ok(!inlineMime.includes('data:image'), 'no data URL survives into the raw message')

// An inline image plus a real file attachment keeps both dispositions.
const both = await buildRawMessage('me@example.com', {
  to: 'you@example.com',
  subject: 'both test',
  body: 'both',
  bodyHtml: '<p>x</p><img src="data:image/png;base64,' + imageBytes.toString('base64') + '">',
  attachments: [{ filename: 'doc.pdf', size: bytes.length, data: bytes.toString('base64') }]
})
const bothMime = base64UrlToBuffer(both).toString('utf-8')
assert.match(bothMime, /Content-Disposition: attachment; filename=doc\.pdf/, 'the file stays an attachment part')
assert.match(bothMime, /Content-ID: <inline-1@mailsy>/, 'the inline image rides besides it')

console.log('mime attachment harness: ok')
