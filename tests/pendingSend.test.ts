import assert from 'node:assert/strict'
import { test } from 'node:test'
import { holdSend } from '../src/renderer/src/lib/pendingSend.ts'

function scheduleFixture(): {
  undo: () => boolean
  delayMs: number
  fireTimer: () => void
  counts: () => { sends: number; cancels: number }
} {
  let scheduled = (): void => {}
  let delayMs = 0
  let cancels = 0
  let sends = 0
  const undo = holdSend(
    (delay, commit) => {
      delayMs = delay
      scheduled = commit
      return () => cancels++
    },
    () => sends++
  )
  return {
    undo,
    delayMs,
    fireTimer: () => scheduled(),
    counts: () => ({ sends, cancels })
  }
}

test('send waits five seconds and commits only once', () => {
  const pending = scheduleFixture()
  assert.equal(pending.delayMs, 5000)
  assert.deepEqual(pending.counts(), { sends: 0, cancels: 0 })
  pending.fireTimer()
  assert.equal(pending.undo(), false)
  pending.fireTimer()
  assert.deepEqual(pending.counts(), { sends: 1, cancels: 0 })
})

test('undo cancels the delay and prevents a stale timer from sending', () => {
  const pending = scheduleFixture()
  assert.equal(pending.undo(), true)
  assert.equal(pending.undo(), false)
  pending.fireTimer()
  assert.deepEqual(pending.counts(), { sends: 0, cancels: 1 })
})

test('leftSends publishes added, updated and removed sends to subscribers', async () => {
  const { leftSends } = await import('../src/renderer/src/lib/pendingSend.ts')
  let notified = 0
  const unsubscribe = leftSends.subscribe(() => notified++)
  const id = leftSends.add({ phase: 'waiting', draftId: 'd1', undo: () => true })
  assert.deepEqual(
    leftSends.snapshot().map(({ id: sendId, phase, draftId }) => ({ sendId, phase, draftId })),
    [{ sendId: id, phase: 'waiting', draftId: 'd1' }]
  )
  leftSends.update(id, { phase: 'failed', error: 'boom' })
  assert.equal(leftSends.snapshot()[0].error, 'boom')
  leftSends.remove(id)
  assert.deepEqual(leftSends.snapshot(), [])
  unsubscribe()
  leftSends.add({ phase: 'sending', undo: () => false })
  assert.equal(notified, 3)
})
