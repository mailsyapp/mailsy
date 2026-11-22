import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { test } from 'node:test'

const fixture = (globalThis.draftVersionFixture = {
  session: Symbol(),
  messageId: 'msg-1',
  calls: [],
  get: () => ({ data: { message: { id: fixture.messageId } } }),
  create: (params) => {
    fixture.calls.push(['create', params])
    return { data: { id: 'draft-local-copy', message: { id: 'msg-copy' } } }
  },
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
          create: (...args) => f.create(...args),
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

test('unmount recovery creates a separate draft only on a version conflict', async () => {
  fixture.calls.length = 0
  fixture.messageId = 'msg-remote'
  const edited = { ...request, expectedMessageId: 'msg-1', copyOnConflict: true }
  assert.deepEqual(await saveDraft(edited), { draftId: 'draft-local-copy', messageId: 'msg-copy' })
  assert.equal(fixture.messageId, 'msg-remote')
  assert.deepEqual(fixture.calls.map(([verb]) => verb), ['create'])
  assert.equal(fixture.calls[0][1].requestBody.message.threadId, undefined)
  assert.match(
    Buffer.from(fixture.calls[0][1].requestBody.message.raw, 'base64url').toString(),
    /Edited locally/
  )
  await saveDraft({ ...edited, expectedMessageId: 'msg-remote' })
  assert.deepEqual(fixture.calls.map(([verb]) => verb), ['create', 'update'])
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

test('unmount recovery keeps pending edits without restoring the deleted draft', async () => {
  fixture.calls.length = 0
  const originalGet = fixture.get
  const missing = Object.assign(new Error('Requested entity was not found'), { code: 404 })
  fixture.get = () => { throw missing }
  const edited = { ...request, expectedMessageId: 'msg-1' }
  try {
    await assert.rejects(saveDraft(edited), missing)
    await assert.rejects(sendDraft(edited), missing)
    assert.deepEqual(fixture.calls, [])
    assert.deepEqual(await saveDraft({ ...edited, copyOnConflict: true }), {
      draftId: 'draft-local-copy',
      messageId: 'msg-copy'
    })
    assert.deepEqual(fixture.calls.map(([verb]) => verb), ['create'])
    assert.equal(fixture.calls[0][1].requestBody.message.threadId, undefined)
  } finally {
    fixture.get = originalGet
  }
})

test('unmount recovery handles deletion between the version check and update', async () => {
  fixture.calls.length = 0
  fixture.messageId = 'msg-1'
  const originalUpdate = fixture.update
  fixture.update = () => {
    throw Object.assign(new Error('Requested entity was not found'), { code: 404 })
  }
  const edited = { ...request, expectedMessageId: 'msg-1', copyOnConflict: true }
  try {
    assert.deepEqual(await saveDraft(edited), {
      draftId: 'draft-local-copy',
      messageId: 'msg-copy'
    })
    assert.deepEqual(fixture.calls.map(([verb]) => verb), ['create'])
    fixture.calls.length = 0
    fixture.update = () => {
      fixture.session = Symbol()
      throw Object.assign(new Error('Requested entity was not found'), { code: 404 })
    }
    await assert.rejects(saveDraft(edited), /account changed/i)
    assert.deepEqual(fixture.calls, [])
  } finally {
    fixture.update = originalUpdate
  }
})
