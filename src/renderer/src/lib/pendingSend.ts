export const UNDO_SEND_DELAY_MS = 5000

export function holdSend(
  schedule: (delayMs: number, commit: () => void) => () => void,
  send: () => void
): () => boolean {
  let pending = true
  const cancel = schedule(UNDO_SEND_DELAY_MS, () => {
    if (!pending) return
    pending = false
    send()
  })
  return () => {
    if (!pending) return false
    pending = false
    cancel()
    return true
  }
}
