import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleUndoSend, UNDO_SEND_MS } from '../../../../src/renderer/src/lib/undoSend.ts'

function fixture() {
  const pending = new Map()
  const events = []
  const timers = {
    start(key, delay, action) {
      assert.equal(delay, UNDO_SEND_MS)
      pending.set(key, action)
    },
    cancel: (key) => pending.delete(key),
    isPending: (key) => pending.has(key)
  }
  return {
    events,
    enqueue: (key) =>
      scheduleUndoSend(
        timers,
        key,
        () => events.push(`sent ${key}`),
        () => events.push(`restored ${key}`)
      ),
    expire(key) {
      const deliver = pending.get(key)
      pending.delete(key)
      deliver?.()
    },
    clear: () => pending.clear()
  }
}

test('undo cancels just its draft and expiry makes later undo a no-op', () => {
  const { events, enqueue, expire } = fixture()
  const undoFirst = enqueue('first')
  const undoSecond = enqueue('second')
  assert.deepEqual(events, [])
  undoFirst()
  undoFirst()
  expire('first')
  expire('second')
  undoSecond()
  assert.deepEqual(events, ['restored first', 'sent second'])
})

test('clearing the timer owner does not dispatch or restore pending drafts', () => {
  const { events, enqueue, expire, clear } = fixture()
  const undo = enqueue('draft')
  clear()
  expire('draft')
  undo()
  assert.deepEqual(events, [])
})
