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

function loadThreadGetter(attachmentError, { switchAccount = false } = {}) {
  let session = Symbol()
  let signedIn = true
  const requests = []
  const gmail = {
    users: {
      threads: {
        get: async () => {
          if (switchAccount) session = Symbol()
          return { data: thread }
        }
      },
      messages: {
        attachments: {
          get: async ({ id, messageId, userId }) => {
            assert.equal(userId, 'me')
            assert.equal(messageId, 'latest')
            requests.push(id)
            if (id === 'optional') {
              const error = attachmentError(requests.filter((id) => id === 'optional').length)
              if (error) throw error
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
  return { fetchThread: module.exports.fetchThread, requests, isSignedIn: fixture.isSignedIn }
}

test('reads both messages and keeps the other image when one inline attachment keeps returning 429', async () => {
  const { fetchThread, requests } = loadThreadGetter(() => new Error('429 Too Many Requests'))
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
  const { fetchThread, requests } = loadThreadGetter((attempt) =>
    attempt === 1 ? new Error('429 Too Many Requests') : undefined
  )
  const { messages } = await fetchThread('thread')

  assert.equal(messages[1].bodyHtml, html.replace(/cid:(optional|other)/g, dataUrl))
  assert.deepEqual(requests, ['optional', 'other', 'optional'])
})

test('an expired Gmail grant still rejects the thread', async () => {
  const { fetchThread, isSignedIn } = loadThreadGetter(() => new Error('invalid_grant'))

  await assert.rejects(fetchThread('thread'), /your google session has expired/i)
  assert.equal(isSignedIn(), false)
})

test('an account change prevents fetching inline attachments for the previous account', async () => {
  const { fetchThread, requests } = loadThreadGetter(() => undefined, { switchAccount: true })

  await assert.rejects(fetchThread('thread'), /mail account changed/i)
  assert.deepEqual(requests, [])
})
