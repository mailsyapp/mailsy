import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

// Resolve the production bundler's extensionless import when running directly in Node.
register(
  `data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === './mime' && context.parentURL?.endsWith('/src/main/mail/message.ts')
        ? './mime.ts'
        : specifier,
      context
    )
  }
`)}`
)
const { toEmailDetail } = await import('../../src/main/mail/message.ts')

const imageData = 'iVBORw0KGgo='
const attachment = {
  mimeType: 'image/png',
  filename: 'photo.png',
  headers: [
    { name: 'Content-ID', value: '<Photo@example.com>' },
    { name: 'content-disposition', value: 'Attachment; filename="photo.png"' }
  ],
  body: { attachmentId: 'photo', size: 8 }
}

function gmailFixture() {
  const fetched = []
  const gmail = {
    users: {
      messages: {
        attachments: {
          get: async ({ id }) => {
            fetched.push(id)
            return { data: { data: imageData } }
          }
        }
      }
    }
  }
  return { gmail, fetched }
}

test('an explicit image attachment with an unused Content-ID is listed without fetching it', async () => {
  const { gmail, fetched } = gmailFixture()
  const detail = await toEmailDetail(gmail, {
    id: 'message',
    payload: {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('See attached.').toString('base64url') }
        },
        attachment,
        {
          mimeType: 'image/png',
          filename: 'scan.png',
          headers: [
            { name: 'Content-ID', value: '<scan@example.com>' },
            { name: 'Content-Disposition', value: 'attachment (original); filename="scan.png"' }
          ],
          body: { data: imageData, size: 8 }
        }
      ]
    }
  })

  assert.deepEqual(detail.attachments, [
    { filename: 'photo.png', size: 8, attachmentId: 'photo' },
    { filename: 'scan.png', size: 8, attachmentId: 'mailsy-part:0.2' }
  ])
  assert.deepEqual(fetched, [])
  assert.equal(detail.bodyText, 'See attached.')
})

test('a CID mentioned only in an HTML comment still belongs to a downloadable file', async () => {
  const { gmail, fetched } = gmailFixture()
  const html = '<p>See attached.</p><!-- cid:photo@example.com -->'
  const detail = await toEmailDetail(gmail, {
    id: 'message',
    payload: {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } },
        attachment
      ]
    }
  })

  assert.deepEqual(detail.attachments, [{ filename: 'photo.png', size: 8, attachmentId: 'photo' }])
  assert.deepEqual(fetched, [])
  assert.equal(detail.bodyHtml, html)
})

test('referenced CIDs render inline and explicitly attached files stay downloadable', async () => {
  const { gmail, fetched } = gmailFixture()
  const html = '<img src="CID:PHOTO%40example.com"><img src="cid:logo@example.com">'
  const detail = await toEmailDetail(gmail, {
    id: 'message',
    payload: {
      mimeType: 'multipart/related',
      parts: [
        { ...attachment, body: { data: imageData, size: 8 } },
        { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } },
        {
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [
            { name: 'Content-ID', value: '<logo@example.com>' },
            { name: 'Content-Disposition', value: 'inline' }
          ],
          body: { attachmentId: 'logo', size: 8 }
        }
      ]
    }
  })

  const inlineImage = `<img src="data:image/png;base64,${imageData}">`
  assert.equal(detail.bodyHtml, inlineImage.repeat(2))
  assert.deepEqual(detail.attachments, [
    { filename: 'photo.png', size: 8, attachmentId: 'mailsy-part:0.0' }
  ])
  assert.deepEqual(fetched, ['logo'])
})
