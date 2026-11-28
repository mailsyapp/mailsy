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
