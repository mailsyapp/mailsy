import { useRef, useState } from 'react'
import { scheduleOutlivingUnmount } from '../hooks/useLeftSends'
import { useOnUnmount } from '../hooks/useOnUnmount'
import { errorMessage } from '../lib/format'
import { holdSend, leftSends } from '../lib/pendingSend'
import type { SendEmailRequest } from '../../../shared/types'
import type { DraftAutosave } from './useDraftAutosave'

type SendPhase = 'idle' | 'preparing' | 'waiting' | 'sending'
type ActivePhase = Exclude<SendPhase, 'idle'>
type SendAttempt = { undo: () => boolean; leave: () => void }
const BUTTON_LABELS: Record<SendPhase, string> = {
  idle: 'Send',
  preparing: 'Preparing...',
  waiting: 'Pending',
  sending: 'Sending...'
}

export function useUndoSend(sessionSignal: AbortSignal): {
  phase: SendPhase
  busy: boolean
  buttonLabel: string
  error: string | null
  start: (request: SendEmailRequest, autosave: DraftAutosave, onSent: () => void) => Promise<void>
  undo: () => void
} {
  const [phase, setPhase] = useState<SendPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const active = useRef<SendAttempt | null>(null)
  useOnUnmount(() => {
    active.current?.leave()
    active.current = null
  })

  async function start(
    request: SendEmailRequest,
    autosave: DraftAutosave,
    onSent: () => void
  ): Promise<void> {
    if (active.current || sessionSignal.aborted) return
    let current: ActivePhase = 'preparing'
    let leftId: number | null = null
    let draftId: string | undefined
    let cancel: (() => boolean) | null = null
    let settled = false
    const attempt: SendAttempt = {
      undo: () => {
        if (!cancel?.()) return false
        if (leftId === null) {
          settle()
          autosave.resume()
        } else {
          settled = true
          leftSends.update(leftId, { phase: 'undone' })
        }
        return true
      },
      leave: () => {
        if (!settled) leftId = leftSends.add({ phase: current, draftId, undo: attempt.undo })
      }
    }
    active.current = attempt
    const mounted = (): boolean => active.current === attempt
    function show(next: ActivePhase): void {
      current = next
      if (mounted()) setPhase(next)
      else if (leftId !== null) leftSends.update(leftId, { phase: next, draftId })
    }
    function settle(failure?: unknown): void {
      if (settled) return
      settled = true
      if (mounted()) {
        sessionSignal.removeEventListener('abort', abandon)
        active.current = null
        setPhase('idle')
        if (failure !== undefined) setError(errorMessage(failure))
      } else if (leftId !== null) {
        if (failure === undefined) {
          sessionSignal.removeEventListener('abort', abandon)
          leftSends.remove(leftId)
        } else
          leftSends.update(leftId, {
            phase: 'failed',
            error: errorMessage(failure),
            draftId: draftId ?? autosave.currentDraft()?.draftId
          })
      }
    }
    function abandon(): void {
      if (current === 'sending' && !settled) return
      cancel?.()
      settled = true
      if (leftId !== null) leftSends.remove(leftId)
      if (mounted()) active.current = null
    }
    sessionSignal.addEventListener('abort', abandon, { once: true })
    setError(null)
    setPhase('preparing')
    try {
      const target = await autosave.saveForSend(request)
      if (settled) return
      draftId = target.draftId
      autosave.suspend()
      cancel = holdSend(scheduleOutlivingUnmount, () => {
        show('sending')
        window.api
          .sendDraft({ ...request, ...target })
          .then(() => {
            autosave.stop()
            settle()
            if (!sessionSignal.aborted) onSent()
          })
          .catch((reason: unknown) => {
            if (mounted()) autosave.resume()
            settle(sessionSignal.aborted ? undefined : reason)
          })
      })
      show('waiting')
    } catch (reason) {
      settle(sessionSignal.aborted ? undefined : reason)
    }
  }

  return {
    phase,
    busy: phase !== 'idle',
    buttonLabel: BUTTON_LABELS[phase],
    error,
    start,
    undo: () => {
      active.current?.undo()
    }
  }
}
