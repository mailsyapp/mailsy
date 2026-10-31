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

console.log('mime attachment harness: ok')
