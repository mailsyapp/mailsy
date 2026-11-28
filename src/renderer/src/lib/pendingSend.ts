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

export type LeftSendPhase = 'preparing' | 'waiting' | 'sending' | 'failed' | 'undone'
export type LeftSend = {
  id: number
  phase: LeftSendPhase
  draftId?: string
  error?: string
  undo: () => boolean
  onRemove?: () => void
}

let leftSendList: readonly LeftSend[] = []
let nextLeftSendId = 0
const leftSendListeners = new Set<() => void>()

function publishLeftSends(next: readonly LeftSend[]): void {
  leftSendList = next
  leftSendListeners.forEach((listener) => listener())
}

export const leftSends = {
  subscribe(listener: () => void): () => void {
    leftSendListeners.add(listener)
    return () => {
      leftSendListeners.delete(listener)
    }
  },
  snapshot: (): readonly LeftSend[] => leftSendList,
  add(send: Omit<LeftSend, 'id'>): number {
    const id = ++nextLeftSendId
    publishLeftSends([...leftSendList, { ...send, id }])
    return id
  },
  update(id: number, patch: Partial<Pick<LeftSend, 'phase' | 'draftId' | 'error'>>): void {
    publishLeftSends(leftSendList.map((send) => (send.id === id ? { ...send, ...patch } : send)))
  },
  remove(id: number): void {
    const removed = leftSendList.find((send) => send.id === id)
    if (!removed) return
    publishLeftSends(leftSendList.filter((send) => send !== removed))
    removed.onRemove?.()
  },
  forgetDraft(draftId: string | undefined): void {
    if (!draftId) return
    leftSendList
      .filter(
        (send) => send.draftId === draftId && (send.phase === 'undone' || send.phase === 'failed')
      )
      .forEach((send) => leftSends.remove(send.id))
  }
}
