import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import type { SaveDraftRequest } from '../../src/shared/types'

const writes: { requestBody: { message: { raw: string } } }[] = []
const fetches: { messageId: string; id: string }[] = []
let unavailable = false
let original = Buffer.from('original bytes').toString('base64url')
const gmail = {
  users: {
    messages: {
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
  entryPoints: [fileURLToPath(new URL('../../src/main/mail/send.ts', import.meta.url))],
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
const { saveDraft } = loaded.exports as {
  saveDraft: (request: SaveDraftRequest) => Promise<string>
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
