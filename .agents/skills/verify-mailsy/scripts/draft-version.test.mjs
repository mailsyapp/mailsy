import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { test } from 'node:test'

const fixture = (globalThis.draftVersionFixture = {
  session: Symbol(),
  messageId: 'msg-1',
  calls: [],
  get: () => ({ data: { message: { id: fixture.messageId } } }),
  update: (params) => {
    fixture.calls.push(['update', params])
    fixture.messageId = 'msg-2'
    return { data: { id: params.id, message: { id: fixture.messageId } } }
  },
  send: (params) => fixture.calls.push(['send', params])
})

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../auth') {
      const mock = `
        const f = globalThis.draftVersionFixture
        export const getMailSession = () => f.session
        export const getAccountEmail = () => 'me@example.com'
        export const isSignedIn = () => true
        export const invalidateStoredGrant = () => { f.session = Symbol() }
        export const getGmailClient = () => ({ users: { drafts: {
          get: (...args) => f.get(...args),
          update: (...args) => f.update(...args),
          send: (...args) => f.send(...args)
        } } })
      `
      return { url: `data:text/javascript,${encodeURIComponent(mock)}`, shortCircuit: true }
    }
    return next(
      specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier,
      context
    )
  }
})
const { saveDraft, sendDraft } = await import('../../../../src/main/mail/send.ts')
hooks.deregister()

const request = {
  draftId: 'draft-1',
  to: 'reader@example.com',
  subject: 'Draft',
  body: 'Edited locally',
  threadId: 'thread-1'
}

test('save advances the message version; send uses the new version and replacement MIME', async () => {
  fixture.calls.length = 0
  fixture.messageId = 'msg-1'
  assert.deepEqual(await saveDraft({ ...request, expectedMessageId: 'msg-1' }), {
    draftId: 'draft-1',
    messageId: 'msg-2'
  })
  await sendDraft({ ...request, expectedMessageId: 'msg-2' })
  assert.deepEqual(fixture.calls.map(([verb]) => verb), ['update', 'send'])
  const { id, message } = fixture.calls[1][1].requestBody
  assert.equal(id, request.draftId)
  assert.equal(message.threadId, request.threadId)
  assert.match(Buffer.from(message.raw, 'base64url').toString(), /Edited locally/)
})

test('an already-replaced Gmail message blocks both autosave and send', async () => {
  fixture.calls.length = 0
  fixture.messageId = 'msg-remote'
  const stale = { ...request, expectedMessageId: 'msg-1' }
  await assert.rejects(saveDraft(stale), /Draft changed in Gmail/)
  await assert.rejects(sendDraft(stale), /Draft changed in Gmail/)
  assert.deepEqual(fixture.calls, [])
})

test('a version check finishing after an account switch cannot start a write', async () => {
  fixture.calls.length = 0
  const originalGet = fixture.get
  fixture.get = async () => {
    fixture.session = Symbol()
    return { data: { message: { id: 'msg-1' } } }
  }
  try {
    await assert.rejects(saveDraft({ ...request, expectedMessageId: 'msg-1' }), /account changed/i)
    assert.deepEqual(fixture.calls, [])
  } finally {
    fixture.get = originalGet
  }
})
