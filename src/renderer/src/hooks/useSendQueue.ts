import { useRef, useState } from 'react'
import type { DraftVersion, SendDraftRequest } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { scheduleUndoSend } from '../lib/undoSend'
import { useTimers } from './useTimers'

type QueuedSend = {
  request: SendDraftRequest
  version: DraftVersion
  session: AbortSignal
  restore: () => boolean
  complete: () => void
  fail: (message: string) => boolean
}

type Notice = {
  draftId: string
  subject: string
  status: 'waiting' | 'sending' | 'failed'
  error?: string
  action?: () => void
  dismiss?: () => void
}

export interface SendQueue {
  enqueue: (send: QueuedSend) => void
  isLocked: (draftId: string) => boolean
}

export function useSendQueue(
  reopenDraft: (draft: DraftVersion, subject: string) => void,
  onDelivered: (draftId: string) => void
): {
  queue: SendQueue
  notices: Notice[]
  clear: () => void
} {
  const timers = useTimers()
  const locked = useRef(new Set<string>())
  const [notices, setNotices] = useState<Notice[]>([])

  function enqueue({ request, version, session, restore, complete, fail }: QueuedSend): void {
    const { draftId, subject } = request
    if (locked.current.has(draftId)) throw new Error('This draft is already queued to send.')
    locked.current.add(draftId)

    function removeNotice(): void {
      setNotices((previous) => previous.filter((notice) => notice.draftId !== draftId))
    }
    function show(notice: Omit<Notice, 'draftId' | 'subject'>): void {
      setNotices((previous) => [
        ...previous.filter((item) => item.draftId !== draftId),
        { ...notice, draftId, subject }
      ])
    }
    function recover(): void {
      if (!session.aborted && !restore()) reopenDraft(version, subject)
    }
    const undo = scheduleUndoSend(
      timers,
      draftId,
      () => {
        if (session.aborted) {
          locked.current.delete(draftId)
          removeNotice()
          return
        }
        show({ status: 'sending' })
        void window.api.sendDraft(request).then(
          () => {
            if (session.aborted) return
            locked.current.delete(draftId)
            removeNotice()
            complete()
            onDelivered(draftId)
          },
          (error: unknown) => {
            if (session.aborted) return
            locked.current.delete(draftId)
            const message = errorMessage(error)
            if (fail(message)) removeNotice()
            else
              show({
                status: 'failed',
                error: message,
                action: () => {
                  removeNotice()
                  recover()
                },
                dismiss: removeNotice
              })
          }
        )
      },
      () => {
        locked.current.delete(draftId)
        removeNotice()
        recover()
      }
    )
    show({
      status: 'waiting',
      action: () => {
        if (!session.aborted) undo()
      }
    })
  }

  return {
    queue: { enqueue, isLocked: (draftId) => locked.current.has(draftId) },
    notices,
    clear: () => {
      timers.cancelAll()
      locked.current.clear()
      setNotices([])
    }
  }
}
