import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'
import { build } from 'esbuild'

const encode = (text) => Buffer.from(text).toString('base64url')
const image = (id, body) => ({
  mimeType: 'image/png',
  headers: [{ name: 'Content-ID', value: `<${id}>` }],
  body
})
const html = '<p>Before</p><img src="cid:optional"><img src="cid:other"><p>After</p>'
const thread = {
  id: 'thread',
  messages: [
    {
      id: 'first',
      payload: { mimeType: 'text/plain', body: { data: encode('First message') } }
    },
    {
      id: 'latest',
      payload: {
        mimeType: 'multipart/related',
        parts: [
          { mimeType: 'text/html', body: { data: encode(html) } },
          image('optional', { attachmentId: 'optional' }),
          image('other', { attachmentId: 'other' })
        ]
      }
    }
  ]
}
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII='
const dataUrl = `data:image/png;base64,${png}`
const encodedPng = Buffer.from(png, 'base64').toString('base64url')

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../src/main/mail/messages.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  packages: 'external',
  write: false,
  plugins: [
    {
      name: 'thread-fixtures',
      setup(builder) {
        const fixtures = {
          auth: 'export const { getGmailClient, getAccountEmail, getMailSession, invalidateStoredGrant, isSignedIn } = threadFixture',
          sync: 'export const noteHistoryId = () => {}',
          snooze: 'export const getSnoozeUntil = () => null'
        }
        builder.onResolve({ filter: /^\.\.\/auth$|^\.\/(sync|snooze)$/ }, ({ path }) => ({
          path: path.split('/').at(-1),
          namespace: 'fixture'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: fixtures[path]
        }))
      }
    }
  ]
})

function loadReaders(attachmentError, { switchAccountDuring } = {}) {
  let session = Symbol()
  let signedIn = true
  const requests = []
  const gmail = {
    users: {
      threads: {
        get: async () => {
          if (switchAccountDuring === 'thread') session = Symbol()
          return { data: thread }
        }
      },
      drafts: { get: async () => ({ data: { message: thread.messages[1] } }) },
      messages: {
        get: async () => ({ data: thread.messages[1] }),
        attachments: {
          get: async ({ id, messageId, userId }) => {
            assert.equal(userId, 'me')
            assert.equal(messageId, 'latest')
            requests.push(id)
            if (id === 'optional') {
              const error = attachmentError(requests.filter((id) => id === 'optional').length)
              if (error) throw error
              if (switchAccountDuring === 'attachment') {
                await Promise.resolve()
                session = Symbol()
              }
            }
            return { data: { data: encodedPng } }
          }
        }
      }
    }
  }
  const fixture = {
    getGmailClient: () => gmail,
    getAccountEmail: async () => 'me@example.com',
    getMailSession: () => session,
    isSignedIn: () => signedIn,
    invalidateStoredGrant: () => {
      session = Symbol()
      signedIn = false
    }
  }
  const module = { exports: {} }
  compileFunction(compiled.outputFiles[0].text, ['require', 'module', 'threadFixture'])(
    createRequire(import.meta.url),
    module,
    fixture
  )
  return { ...module.exports, requests, isSignedIn: fixture.isSignedIn }
}

test('reads both messages and keeps the other image when one inline attachment keeps returning 429', async () => {
  const { fetchThread, requests } = loadReaders(() =>
    Object.assign(new Error('Too Many Requests'), { response: { status: 429 } })
  )
  const { messages } = await fetchThread('thread')

  assert.deepEqual(
    messages.map(({ id }) => id),
    ['first', 'latest']
  )
  assert.equal(messages[0].bodyText, 'First message')
  assert.equal(messages[1].bodyHtml, html.replace('cid:other', dataUrl))
  assert.deepEqual(requests, ['optional', 'other', 'optional', 'optional'])
})

test('embeds an inline attachment that succeeds after a quota retry', async () => {
  const { fetchThread, requests } = loadReaders((attempt) =>
    attempt === 1 ? Object.assign(new Error('Too Many Requests'), { code: 429 }) : undefined
  )
  const { messages } = await fetchThread('thread')

  assert.equal(messages[1].bodyHtml, html.replace(/cid:(optional|other)/g, dataUrl))
  assert.deepEqual(requests, ['optional', 'other', 'optional'])
})

test('an expired Gmail grant still rejects the thread', async () => {
  const { fetchThread, isSignedIn } = loadReaders(() => new Error('invalid_grant'))

  await assert.rejects(fetchThread('thread'), /your google session has expired/i)
  assert.equal(isSignedIn(), false)
})

test('an account change prevents fetching inline attachments for the previous account', async () => {
  const { fetchThread, requests } = loadReaders(() => undefined, { switchAccountDuring: 'thread' })

  await assert.rejects(fetchThread('thread'), /mail account changed/i)
  assert.deepEqual(requests, [])
})

test('an account change during a successful image download rejects the stale thread', async () => {
  const { fetchThread, requests } = loadReaders(() => undefined, {
    switchAccountDuring: 'attachment'
  })

  await assert.rejects(fetchThread('thread'), /mail account changed/i)
  assert.deepEqual(requests, ['optional', 'other'])
})

test('a message opened for editing still rejects when an inline image is unavailable', async () => {
  const missingImage = new Error('Attachment unavailable')
  const { fetchMessage } = loadReaders(() => missingImage)

  await assert.rejects(fetchMessage('latest', 'draft'), missingImage)
  await assert.rejects(fetchMessage('latest'), missingImage)
})
