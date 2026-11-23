import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import type { SaveDraftRequest, SaveDraftResult } from '../../src/shared/types'
import type { MessageBodies } from '../../src/main/mail/mime'
import type { gmail_v1 } from 'googleapis'

const writes: { requestBody: { message: { raw: string } } }[] = []
const fetches: { messageId: string; id: string }[] = []
let unavailable = false
let readbackUnavailable = false
let creates = 0
const updateIds: string[] = []
let original = Buffer.from('original bytes').toString('base64url')
let inlinePayload: gmail_v1.Schema$MessagePart | undefined
let inlineUnavailable = false
const messageFetches: { id: string; format: string }[] = []
const savedMessages = new Map<string, gmail_v1.Schema$MessagePart>()
const gmail = {
  users: {
    messages: {
      get: async (request: {
        id: string
        format: string
      }): Promise<{ data: { payload?: gmail_v1.Schema$MessagePart } }> => {
        messageFetches.push(request)
        if (inlineUnavailable) throw new Error('Inline original unavailable')
        return { data: { payload: savedMessages.get(request.id) ?? inlinePayload } }
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
      get: async (): Promise<{ data: gmail_v1.Schema$Draft }> => {
        if (readbackUnavailable) throw new Error('Saved draft readback unavailable')
        const raw = Buffer.from(writes.at(-1)!.requestBody.message.raw, 'base64url')
          .toString()
          .replace(/\r\n/g, '\n')
        const files = [
          ...raw.matchAll(/Content-Disposition: attachment; filename=([^\n]+)([\s\S]*?)(?=\n--)/g)
        ]
        const payload = {
          mimeType: 'multipart/mixed',
          parts: files.map((match) => {
            const data = (match[2].split('\n\n')[1] ?? '').replace(/\s/g, '')
            return {
              filename: match[1].replace(/^"|"$/g, ''),
              mimeType: 'application/octet-stream',
              body: { data, size: Buffer.from(data, 'base64').length }
            }
          })
        }
        savedMessages.set(`saved-message-${writes.length}`, payload)
        return {
          data: {
            message: {
              id: `saved-message-${writes.length}`,
              payload
            }
          }
        }
      },
      update: async (
        request: (typeof writes)[number] & { id: string }
      ): Promise<{ data: gmail_v1.Schema$Draft }> => {
        writes.push(request)
        updateIds.push(request.id)
        return { data: { id: request.id, message: { id: `saved-message-${writes.length}` } } }
      },
      create: async (
        request: (typeof writes)[number]
      ): Promise<{ data: gmail_v1.Schema$Draft }> => {
        writes.push(request)
        creates++
        return { data: { id: 'created-draft', message: { id: `saved-message-${writes.length}` } } }
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
        builder.onResolve({ filter: /\/snooze$/ }, () => ({ path: 'snooze', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'auth'
              ? 'export const isSignedIn = () => true; export const getMailSession = () => Symbol.for("retained-harness"); export const getGmailClient = () => globalThis.__draftRetainHarness.gmail; export const getAccountEmail = async () => "me@example.com"; export const invalidateStoredGrant = () => {}'
              : path === 'snooze'
                ? 'export const getSnoozeUntil = () => null'
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
  saveDraft: (request: SaveDraftRequest) => Promise<SaveDraftResult>
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
const savedResult = await saveDraft(request)
assert.equal(savedResult.draftId, 'existing-draft')
assert.equal(savedResult.messageId, 'saved-message-1')
assert.equal(savedResult.previousMessageId, 'original-message')
assert.equal(savedResult.retainedAttachments[0].previousAttachmentId, 'original-id')
assert.equal(savedResult.retainedAttachments[0].ref.attachmentId, 'mailsy-part:0.1')
assert.equal(savedResult.retainedAttachments[0].ref.filename, 'original.bin')
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
  (
    await saveDraft({
      to: '',
      subject: '',
      body: '',
      retainAttachments: { messageId: 'empty', refs: [] }
    })
  ).draftId,
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

inlinePayload = {
  mimeType: 'application/octet-stream',
  filename: 'empty.bin',
  body: { data: '', size: 0 }
}
const emptyBodies: MessageBodies = { text: '', html: '', inlineImages: [], attachments: [] }
collectBodies(inlinePayload, emptyBodies)
assert.equal(emptyBodies.attachments.length, 1)
assert.equal(await fetchAttachment('empty-message', emptyBodies.attachments[0].attachmentId), '')
const emptyResult = await saveDraft({
  ...request,
  attachments: [],
  retainAttachments: { messageId: 'empty-message', refs: emptyBodies.attachments }
})
const emptyRef = emptyResult.retainedAttachments[0].ref
assert.equal(emptyRef.filename, 'empty.bin')
assert.equal(emptyRef.size, 0)
assert.equal(await fetchAttachment(emptyResult.messageId, emptyRef.attachmentId), '')
const emptyAgain = await saveDraft({
  ...request,
  attachments: [],
  retainAttachments: { messageId: emptyResult.messageId, refs: [emptyRef] }
})
assert.equal(emptyAgain.retainedAttachments[0].ref.size, 0)
assert.equal(savedMessages.get(emptyAgain.messageId)?.parts?.[0].body?.data, '')
assert.match(
  Buffer.from(writes.at(-1)!.requestBody.message.raw, 'base64url').toString(),
  /filename=empty.bin/
)
console.log(
  'pass: a zero-byte inline original saves, remains a named empty MIME part, and survives the next retained save'
)

await saveDraft({
  to: '',
  subject: '',
  body: '',
  attachments: [{ filename: 'empty.bin', size: 0, data: '' }]
})
console.log('pass: an already loaded zero-byte attachment also saves')
const invalidBefore = writes.length
for (const data of ['!', 'A', 'A===', 'AA=', 'AA==junk', 'AAAA====', 'A A A A', '-_8=']) {
  await assert.rejects(
    saveDraft({
      to: '',
      subject: '',
      body: '',
      attachments: [{ filename: 'bad.bin', size: 1, data }]
    }),
    /Invalid email request/
  )
}
await assert.rejects(
  saveDraft({
    to: '',
    subject: '',
    body: '',
    attachments: [{ filename: 'missing.bin', size: 1, data: '' }]
  }),
  /Invalid email request/
)
assert.equal(writes.length, invalidBefore)
console.log(
  'pass: malformed base64 and empty data claiming nonzero size cannot reach a draft write'
)
for (const data of ['Zg', 'Zg==', 'Zm8', 'Zm8=']) {
  await saveDraft({
    to: '',
    subject: '',
    body: '',
    attachments: [{ filename: 'valid.bin', size: Buffer.from(data, 'base64').length, data }]
  })
}
console.log('pass: valid padded and unpadded nonempty base64 attachments still save')

const { chromium } = createRequire(new URL('../skills/verify-mailsy/drive/', import.meta.url))(
  'playwright'
)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.clock.install()
  const calls: SaveDraftRequest[] = []
  const results: SaveDraftResult[] = []
  const createsBefore = creates
  const updatesBefore = updateIds.length
  const fetchesBefore = fetches.length
  original = Buffer.from('original bytes').toString('base64url')
  readbackUnavailable = true
  await page.exposeFunction(
    'persistDraft',
    async (fields: SaveDraftRequest): Promise<SaveDraftResult> => {
      calls.push(fields)
      const result = await saveDraft(fields)
      results.push(result)
      return result
    }
  )
  const client = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { useDraftAutosave } from './src/renderer/src/components/useDraftAutosave';
        window.api = { saveDraft: window.persistDraft };
        function Harness() {
          const [subject, setSubject] = useState('initial');
          const [ready, setReady] = useState(false);
          const fields = ${JSON.stringify({ ...request, draftId: undefined })};
          fields.subject = subject;
          if (ready) {
            fields.retainAttachments = undefined;
            fields.attachments.push({filename:'original.bin', size:14, data:${JSON.stringify(Buffer.from('original bytes').toString('base64'))}});
          }
          const [session] = useState(() => new AbortController().signal);
          const autosave = useDraftAutosave(fields, undefined, true, session);
          window.autosave = autosave;
          return React.createElement('div', null,
            React.createElement('input', {'aria-label':'Subject', value:subject, onChange:e=>setSubject(e.target.value)}),
            React.createElement('button', {onClick:()=>setReady(true)}, 'Original loaded'),
            React.createElement('p', {'data-testid':'draft-id'}, autosave.currentDraft()?.draftId ?? ''),
            React.createElement('p', {role:'alert'}, autosave.error ?? ''),
            React.createElement('p', {role:'status'}, autosave.status));
        }
        createRoot(document.getElementById('root')).render(React.createElement(Harness));
      `,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url))
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false
  })
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: client.outputFiles[0].text })
  await page.getByRole('textbox', { name: 'Subject' }).fill('First edit')
  await page.clock.runFor(1300)
  await page.waitForFunction(() => window.autosave.error !== null)
  assert.equal(
    await page.getByTestId('draft-id').textContent(),
    'created-draft',
    'a committed create must return its draft id even if readback fails'
  )
  assert.equal(results[0].messageId, `saved-message-${writes.length}`)
  assert.equal(results[0].refsStale, true)
  assert.match(await page.getByRole('alert').textContent(), /reload/i)
  await page.getByRole('textbox', { name: 'Subject' }).fill('Second edit')
  await page.clock.runFor(1300)
  await page.evaluate(() => window.autosave.flushPending())
  assert.equal(calls.length, 1, 'retaining autosave must not dispatch stale refs')
  readbackUnavailable = false
  await page.getByRole('button', { name: 'Original loaded' }).click()
  await page.clock.runFor(1300)
  await page.waitForFunction(() => window.autosave.status === 'saved')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].draftId, 'created-draft')
  assert.equal(calls[1].retainAttachments, undefined)
  assert.equal(
    creates,
    createsBefore + 1,
    'the next save must update the committed draft, never create a duplicate'
  )
  assert.deepEqual(updateIds.slice(updatesBefore), ['created-draft'])
  assert.equal(fetches.length, fetchesBefore + 1, 'no fetch may use retired attachment ids')
  console.log(
    'pass: failed readback returns committed ids; stale retaining saves are blocked with a reload error; the next safe save updates without duplicates or dead refs'
  )
} finally {
  await browser.close()
}
