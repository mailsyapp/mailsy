import { useRef, useState, type RefObject } from 'react'
import type { SendEmailRequest } from '../../../shared/types'
import { useOnMount } from '../hooks/useOnMount'
import type { SendQueue } from '../hooks/useSendQueue'
import { errorMessage } from '../lib/format'
import type { ComposerBodyHandle } from './ComposerBody'
import type { DraftAutosave } from './useDraftAutosave'

export function useUndoSend({
  autosave,
  bodyRef,
  queue,
  session,
  onQueued,
  onSent
}: {
  autosave: DraftAutosave
  bodyRef: RefObject<ComposerBodyHandle | null>
  queue: SendQueue
  session: AbortSignal
  onQueued?: () => void
  onSent: () => void
}): {
  send: (request: SendEmailRequest) => Promise<void>
  preparing: boolean
  hidden: boolean
  error: string | null
} {
  const [preparing, setPreparing] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef<() => boolean>(() => false)
  useOnMount((isMounted) => {
    mounted.current = isMounted
  })

  async function send(request: SendEmailRequest): Promise<void> {
    if (busy.current || session.aborted) return
    busy.current = true
    setPreparing(true)
    setError(null)
    const isMounted = mounted.current
    try {
      const body = bodyRef.current?.read()
      const snapshot = body
        ? { ...request, body: body.text, bodyHtml: body.html || undefined }
        : request
      const version = await autosave.saveForSend(snapshot, queue.isLocked)
      if (session.aborted || !isMounted()) return
      autosave.suspend()
      function restore(): boolean {
        autosave.resume()
        busy.current = false
        if (!isMounted()) return false
        setHidden(false)
        return true
      }
      try {
        queue.enqueue({
          request: { ...snapshot, draftId: version.draftId, expectedMessageId: version.messageId },
          version,
          session,
          restore,
          complete: () => {
            autosave.stop()
            if (!isMounted()) return
            setHidden(false)
            onSent()
          },
          fail: (message) => {
            if (!restore()) return false
            setError(message)
            return true
          }
        })
      } catch (cause) {
        autosave.resume()
        throw cause
      }
      onQueued?.()
      setHidden(true)
    } catch (cause) {
      busy.current = false
      if (isMounted() && !session.aborted) setError(errorMessage(cause))
    } finally {
      if (isMounted()) setPreparing(false)
    }
  }

  return { send, preparing, hidden, error }
}
