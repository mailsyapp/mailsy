import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { test } from 'node:test'

const fixture = (globalThis.mailSyncFixture = {
  session: Symbol(),
  history: [],
  pushed: [],
  endSession: () => {},
  switchAccount() {
    this.session = Symbol()
    this.endSession()
  }
})

function moduleFrom(source) {
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
}

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../auth') {
      return moduleFrom(`
        const f = globalThis.mailSyncFixture
        export const getMailSession = () => f.session
        export const isSignedIn = () => true
        export const getGmailClient = () => ({ users: {
          history: { list: ({ startHistoryId }) => {
            const request = Promise.withResolvers()
            f.history.push({ startHistoryId, ...request })
            return request.promise
          } },
          threads: { get: ({ id }) => ({ data: { id } }) }
        } })
        export const onSessionEnded = (fn) => { f.endSession = fn }
        export const invalidateStoredGrant = () => f.switchAccount()
      `)
    }
    if (specifier === 'electron') {
      return moduleFrom(`
        export const BrowserWindow = {
          getAllWindows: () => [{
            isDestroyed: () => false,
            isVisible: () => true,
            webContents: { send: (_, result) => globalThis.mailSyncFixture.pushed.push(result) }
          }]
        }
      `)
    }
    return next(
      specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier,
      context
    )
  }
})
const { noteHistoryId, syncMail } = await import('../../../../src/main/mail/sync.ts')
hooks.deregister()

test('an old sweep cannot publish mail or interfere with the next account sweep', async () => {
  const firstAccount = fixture.session
  noteHistoryId('90', firstAccount)
  assert.equal((await syncMail('button')).kind, 'reset')
  const old = syncMail('focus')
  fixture.switchAccount()

  noteHistoryId('950', firstAccount)
  noteHistoryId('10', fixture.session)
  const initial = syncMail('button')
  assert.notEqual(initial, old, 'the new account joined the old account sweep')
  assert.equal((await initial).kind, 'reset')
  const current = syncMail('focus')
  assert.equal(fixture.history[1].startHistoryId, '10', 'an old page seeded the new cursor')

  fixture.history[0].resolve({
    data: { historyId: '99', history: [{ messagesAdded: [{ message: { threadId: 'old-mail' } }] }] }
  })
  assert.equal((await old).kind, 'reset')
  assert.deepEqual(fixture.pushed, [], 'an old sweep exposed rows via the push channel')
  assert.equal(syncMail('button'), current, 'the old sweep cleared the new in-flight request')

  fixture.history[1].resolve({ data: { historyId: '11' } })
  const result = await current
  assert.equal(result.historyId, '11')
  assert.deepEqual(fixture.pushed, [result], 'the current sweep still publishes normally')
})

test('a late invalid_grant from the old account does not revoke the new grant', async () => {
  fixture.pushed.length = 0
  fixture.switchAccount()
  noteHistoryId('20', fixture.session)
  assert.equal((await syncMail('button')).kind, 'reset')
  const old = syncMail('focus')
  fixture.switchAccount()
  const currentSession = fixture.session
  fixture.history.at(-1).reject(new Error('invalid_grant'))
  await old.catch(() => {})
  assert.equal(fixture.session, currentSession)
  assert.deepEqual(fixture.pushed, [])
})

test('invalid_grant from the current account still ends its session', async () => {
  noteHistoryId('30', fixture.session)
  assert.equal((await syncMail('button')).kind, 'reset')
  const activeSession = fixture.session
  const current = syncMail('button')
  fixture.history.at(-1).reject(new Error('invalid_grant'))
  await assert.rejects(current, /session has expired/i)
  assert.notEqual(fixture.session, activeSession)
})
