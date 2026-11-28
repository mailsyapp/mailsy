import { useRef, useState } from 'react'
import { useOnUnmount } from '../hooks/useOnUnmount'
import { useTimers } from '../hooks/useTimers'
import { errorMessage } from '../lib/format'
import { holdSend } from '../lib/pendingSend'
import type { SendEmailRequest } from '../../../shared/types'
import type { DraftAutosave } from './useDraftAutosave'

type SendPhase = 'idle' | 'preparing' | 'waiting' | 'sending'
type SendAttempt = { undo?: () => boolean }
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
  const timers = useTimers()
  useOnUnmount(() => {
    active.current?.undo?.()
    active.current = null
  })

  async function start(
    request: SendEmailRequest,
    autosave: DraftAutosave,
    onSent: () => void
  ): Promise<void> {
    if (active.current || sessionSignal.aborted) return
    const attempt: SendAttempt = {}
    active.current = attempt
    const isCurrent = (): boolean => active.current === attempt && !sessionSignal.aborted
    function fail(reason: unknown): void {
      if (isCurrent()) setError(errorMessage(reason))
    }
    function finish(): void {
      if (isCurrent()) {
        active.current = null
        setPhase('idle')
      }
    }
    setError(null)
    setPhase('preparing')
    try {
      const target = await autosave.saveForSend(request)
      if (!isCurrent()) return
      async function send(): Promise<void> {
        try {
          await window.api.sendDraft({ ...request, ...target })
          autosave.stop()
        } finally {
          autosave.resume()
        }
      }
      autosave.suspend()
      const cancel = holdSend(
        (delay, commit) => {
          timers.start('undo-send', delay, commit)
          return () => timers.cancel('undo-send')
        },
        () => {
          if (!isCurrent()) return
          setPhase('sending')
          void send()
            .then(() => {
              if (isCurrent()) onSent()
            })
            .catch(fail)
            .finally(finish)
        }
      )
      attempt.undo = () => {
        if (!cancel()) return false
        autosave.resume()
        return true
      }
      setPhase('waiting')
    } catch (reason) {
      fail(reason)
      finish()
    }
  }

  return {
    phase,
    busy: phase !== 'idle',
    buttonLabel: BUTTON_LABELS[phase],
    error,
    start,
    undo: () => {
      if (!active.current?.undo?.()) return
      active.current = null
      setPhase('idle')
    }
  }
}
