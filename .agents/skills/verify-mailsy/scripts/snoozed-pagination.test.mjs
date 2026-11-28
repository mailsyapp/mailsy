import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { test } from 'node:test'

const session = Symbol()
const labelId = 'Label_42'
const fixture = (globalThis.snoozedPaginationFixture = { session })

function moduleFrom(source) {
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
}

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../auth') {
      return moduleFrom(`
        const f = globalThis.snoozedPaginationFixture
        export const getMailSession = () => f.session
        export const getGmailClient = () => f.gmail
        export const isSignedIn = () => true
        export const onSessionEnded = () => {}
        export const invalidateStoredGrant = () => {}
      `)
    }
    if (specifier === 'electron') {
      return moduleFrom('export const app = {}; export const BrowserWindow = {}')
    }
    return next(
      specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier,
      context
    )
  }
})
const { fetchFolder } = await import('../../../../src/main/mail/folders.ts')
hooks.deregister()

function mockGmail({ native = [], mailsy = [], query, hasLabel = true }) {
  const calls = []
  const details = []
  fixture.gmail = {
    users: {
      labels: {
        list: () => ({
          data: { labels: hasLabel ? [{ id: labelId, name: 'Snoozed by Mailsy' }] : [] }
        })
      },
      threads: {
        list({ labelIds, maxResults, pageToken, q }) {
          const source = labelIds ? 'mailsy' : 'native'
          assert.deepEqual(labelIds, source === 'mailsy' ? [labelId] : undefined)
          assert.equal(
            q,
            source === 'native' ? [query, 'in:snoozed'].filter(Boolean).join(' ') : query
          )
          const rows = source === 'native' ? native : mailsy
          const tokenAt = (offset) => `${source} "${offset}"/+=`
          const start = pageToken ? rows.findIndex((_, i) => i > 0 && tokenAt(i) === pageToken) : 0
          assert.notEqual(start, -1, 'Gmail page token must be sent to the search that issued it')
          calls.push([source, start])
          const end = start + maxResults
          return {
            data: {
              threads: rows.slice(start, end).map((id) => ({ id })),
              ...(end < rows.length ? { nextPageToken: tokenAt(end) } : {})
            }
          }
        },
        get({ id }) {
          details.push(id)
          return {
            data: {
              id,
              messages: [{ id: `message-${id}`, labelIds: mailsy.includes(id) ? [labelId] : [] }]
            }
          }
        }
      }
    }
  }
  return { calls, details }
}

test('Snoozed can load the 31st Mailsy-snoozed thread without any native snoozes', async () => {
  const mailsy = Array.from({ length: 31 }, (_, i) => `mailsy-${i + 1}`)
  const { calls } = mockGmail({ mailsy })
  const options = { folder: 'snoozed' }
  const first = await fetchFolder(options)
  assert.deepEqual(
    first.threads.map(({ id }) => id),
    mailsy.slice(0, 30)
  )
  assert.ok(first.nextPageToken, 'Mailsy has a second page even though Gmail native is exhausted')

  const second = await fetchFolder({ ...options, pageToken: first.nextPageToken })
  assert.deepEqual(
    second.threads.map(({ id }) => id),
    ['mailsy-31']
  )
  assert.equal(second.threads[0].snoozedByMailsy, true)
  assert.equal(second.nextPageToken, null)
  assert.deepEqual(calls, [
    ['native', 0],
    ['mailsy', 0],
    ['mailsy', 30]
  ])
})

test('Snoozed search paginates both sources, deduplicates rows and stops each source on exhaustion', async () => {
  const q = 'subject:followup'
  const { calls, details } = mockGmail({
    native: ['shared', 'native-2', 'native-3', 'native-4', 'native-5'],
    mailsy: ['shared', 'mailsy-2', 'native-2', 'mailsy-4'],
    query: q
  })
  const options = { folder: 'snoozed', maxResults: 2, q }
  const first = await fetchFolder(options)
  const firstIds = first.threads.map(({ id }) => id)
  assert.deepEqual(firstIds, ['shared', 'native-2', 'mailsy-2'])
  assert.ok(first.nextPageToken)

  const second = await fetchFolder({
    ...options,
    pageToken: first.nextPageToken,
    skipRowIds: firstIds
  })
  assert.deepEqual(
    second.threads.map(({ id }) => id),
    ['native-3', 'native-4', 'mailsy-4']
  )
  assert.ok(second.nextPageToken, 'Gmail native still has a page after the Mailsy leg ends')

  const third = await fetchFolder({ ...options, pageToken: second.nextPageToken })
  assert.deepEqual(
    third.threads.map(({ id }) => id),
    ['native-5']
  )
  assert.equal(third.nextPageToken, null)
  assert.deepEqual(calls, [
    ['native', 0],
    ['mailsy', 0],
    ['native', 2],
    ['mailsy', 2],
    ['native', 4]
  ])
  assert.deepEqual(details, [
    'shared',
    'native-2',
    'mailsy-2',
    'native-3',
    'native-4',
    'mailsy-4',
    'native-5'
  ])
})

test('Snoozed still paginates Gmail-native results when the Mailsy label does not exist', async () => {
  const { calls } = mockGmail({ native: ['native-1', 'native-2'], hasLabel: false })
  const options = { folder: 'snoozed', maxResults: 1 }
  const first = await fetchFolder(options)
  assert.deepEqual(
    first.threads.map(({ id }) => id),
    ['native-1']
  )
  assert.ok(first.nextPageToken)

  const second = await fetchFolder({ ...options, pageToken: first.nextPageToken })
  assert.deepEqual(
    second.threads.map(({ id }) => id),
    ['native-2']
  )
  assert.equal(second.nextPageToken, null)
  assert.deepEqual(calls, [
    ['native', 0],
    ['native', 1]
  ])
})
