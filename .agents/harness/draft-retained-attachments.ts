import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import type { SaveDraftRequest } from '../../src/shared/types'
import type { MessageBodies } from '../../src/main/mail/mime'
import type { gmail_v1 } from 'googleapis'

const writes: { requestBody: { message: { raw: string } } }[] = []
const fetches: { messageId: string; id: string }[] = []
let unavailable = false
let original = Buffer.from('original bytes').toString('base64url')
let inlinePayload: gmail_v1.Schema$MessagePart | undefined
let inlineUnavailable = false
const messageFetches: { id: string; format: string }[] = []
const gmail = {
  users: {
    messages: {
      get: async (request: {
        id: string
        format: string
      }): Promise<{ data: { payload?: gmail_v1.Schema$MessagePart } }> => {
        messageFetches.push(request)
        if (inlineUnavailable) throw new Error('Inline original unavailable')
        return { data: { payload: inlinePayload } }
      },
      attachments: {
        get: async (request: {
          messageId: string
          id: string
        }): Promise<{ data: { data: string } }> => {
          fetches.push(request)
          if (unavailable) throw new Error('Original unavailable')
          return { data: { data: original } }
        }
      }
    },
    drafts: {
      update: async (request: (typeof writes)[number]): Promise<void> => {
        writes.push(request)
      },
      create: async (request: (typeof writes)[number]): Promise<{ data: { id: string } }> => {
        writes.push(request)
        return { data: { id: 'created-draft' } }
      }
    }
  }
}
Object.assign(globalThis, { __draftRetainHarness: { gmail } })
const compiled = await build({
  stdin: {
    contents:
      "export { saveDraft } from './src/main/mail/send'; export { fetchAttachment } from './src/main/mail/messages'; export { collectBodies } from './src/main/mail/mime'",
    resolveDir: fileURLToPath(new URL('../../', import.meta.url))
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  plugins: [
    {
      name: 'provider-boundary',
      setup(builder): void {
        builder.onResolve({ filter: /\/auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
        builder.onResolve({ filter: /\/sync$/ }, () => ({ path: 'sync', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'auth'
              ? 'export const getGmailClient = () => globalThis.__draftRetainHarness.gmail; export const getAccountEmail = async () => "me@example.com"; export const invalidateStoredGrant = () => {}'
              : 'export const noteHistoryId = () => {}'
        }))
      }
    }
  ]
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports
)
const { saveDraft, fetchAttachment, collectBodies } = loaded.exports as {
  saveDraft: (request: SaveDraftRequest) => Promise<string>
  fetchAttachment: (messageId: string, attachmentId: string) => Promise<string>
  collectBodies: (part: gmail_v1.Schema$MessagePart, out: MessageBodies) => void
}
const request: SaveDraftRequest = {
  draftId: 'existing-draft',
  to: '',
  subject: 'Edited subject',
  body: 'Edited body',
  retainAttachments: {
    messageId: 'original-message',
    refs: [{ attachmentId: 'original-id', filename: 'original.bin', size: 14 }]
  },
  attachments: [{ filename: 'picked.txt', size: 6, data: Buffer.from('picked').toString('base64') }]
}
assert.equal(await saveDraft(request), 'existing-draft')
assert.equal(fetches[0].messageId, 'original-message')
assert.equal(fetches[0].id, 'original-id')
const mime = Buffer.from(writes[0].requestBody.message.raw, 'base64url').toString()
assert.match(mime, /filename=original.bin/)
assert.match(mime, /filename=picked.txt/)
assert.ok(mime.includes(Buffer.from('original bytes').toString('base64')))
console.log(
  'pass: production saveDraft resolves retained originals and includes their bytes with picked files in MIME'
)
const before = writes.length
unavailable = true
await assert.rejects(saveDraft(request), /Original unavailable/)
assert.equal(writes.length, before)
console.log('pass: an unavailable retained original fails before any draft write')
unavailable = false
for (const retainAttachments of [
  null,
  {},
  { messageId: '', refs: [] },
  { messageId: 'x', refs: [{ filename: 'x', size: 1, attachmentId: '' }] }
]) {
  await assert.rejects(
    saveDraft({ ...request, retainAttachments } as SaveDraftRequest),
    /Invalid draft request/
  )
}
assert.equal(writes.length, before)
original = Buffer.alloc(20 * 1024 * 1024).toString('base64url')
await assert.rejects(saveDraft(request), /Attachments are too large/)
assert.equal(writes.length, before)
console.log('pass: malformed refs and the combined byte limit cannot reach a draft write')
assert.equal(
  await saveDraft({
    to: '',
    subject: '',
    body: '',
    retainAttachments: { messageId: 'empty', refs: [] }
  }),
  'created-draft'
)
assert.doesNotMatch(
  Buffer.from(writes.at(-1)!.requestBody.message.raw, 'base64url').toString(),
  /filename=/
)
console.log('pass: an empty retained list saves an attachment-free draft without fetching')

inlinePayload = {
  mimeType: 'multipart/mixed',
  parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from('body').toString('base64url') } },
    {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'application/octet-stream',
          filename: 'small.bin',
          body: { data: '-_8', size: 2 }
        },
        { mimeType: 'application/octet-stream', filename: 'small.bin', body: { data: '', size: 0 } }
      ]
    },
    {
      mimeType: 'image/png',
      filename: 'logo.png',
      headers: [{ name: 'Content-ID', value: '<logo>' }],
      body: { data: 'AA', size: 1 }
    }
  ]
}
const inlineBodies: MessageBodies = { text: '', html: '', inlineImages: [], attachments: [] }
collectBodies(inlinePayload, inlineBodies)
assert.equal(inlineBodies.text, 'body')
assert.equal(inlineBodies.inlineImages.length, 1)
assert.deepEqual(
  inlineBodies.attachments.map((ref) => ref.attachmentId),
  ['mailsy-part:0.1.0', 'mailsy-part:0.1.1']
)
assert.equal(
  await fetchAttachment('inline-message', inlineBodies.attachments[0].attachmentId),
  '+/8='
)
assert.equal(await fetchAttachment('inline-message', inlineBodies.attachments[1].attachmentId), '')
assert.deepEqual(messageFetches[0], { userId: 'me', id: 'inline-message', format: 'full' })
const inlineRequest: SaveDraftRequest = {
  ...request,
  attachments: [],
  retainAttachments: { messageId: 'inline-message', refs: [inlineBodies.attachments[0]] }
}
await saveDraft(inlineRequest)
const inlineMime = Buffer.from(writes.at(-1)!.requestBody.message.raw, 'base64url').toString()
assert.match(inlineMime, /filename=small.bin/)
assert.ok(inlineMime.includes('+/8='))
console.log(
  'pass: nested inline-data files have stable distinct refs, fetch exact bytes, and survive retained draft MIME'
)
const inlineBefore = writes.length
inlineUnavailable = true
await assert.rejects(saveDraft(inlineRequest), /Inline original unavailable/)
inlineUnavailable = false
await assert.rejects(fetchAttachment('inline-message', 'mailsy-part:0.99'), /Attachment not found/)
await assert.rejects(fetchAttachment('inline-message', 'mailsy-part:0.0'), /Attachment not found/)
for (const id of [
  'mailsy-part:',
  'mailsy-part:1',
  'mailsy-part:0.-1',
  'mailsy-part:0.1x',
  'mailsy-part:0.01'
]) {
  await assert.rejects(fetchAttachment('inline-message', id), /Invalid attachment ID/)
}
inlinePayload = undefined
await assert.rejects(saveDraft(inlineRequest), /Attachment not found/)
assert.equal(writes.length, inlineBefore)
console.log(
  'pass: missing inline parts and failed message reads never strip a retained draft; malformed paths reject'
)
inlinePayload = {
  mimeType: 'application/octet-stream',
  filename: 'root.bin',
  body: { data: Buffer.from('file, not body').toString('base64url'), size: 14 }
}
const rootBodies: MessageBodies = { text: '', html: '', inlineImages: [], attachments: [] }
collectBodies(inlinePayload, rootBodies)
assert.equal(rootBodies.text, '')
assert.equal(rootBodies.attachments[0].attachmentId, 'mailsy-part:0')
assert.equal(
  await fetchAttachment('root-message', 'mailsy-part:0'),
  Buffer.from('file, not body').toString('base64')
)
console.log('pass: a named root inline-data part remains a fetchable file')
