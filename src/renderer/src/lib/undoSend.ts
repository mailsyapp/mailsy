import type { Timers } from '../hooks/useTimers'

export const UNDO_SEND_MS = 5000

export function scheduleUndoSend(
  timers: Timers,
  key: string,
  deliver: () => void,
  restore: () => void
): () => void {
  let waiting = true
  timers.start(key, UNDO_SEND_MS, () => {
    waiting = false
    deliver()
  })
  return () => {
    if (!waiting || !timers.isPending(key)) return
    waiting = false
    timers.cancel(key)
    restore()
  }
}
