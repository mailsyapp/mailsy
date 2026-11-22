import { useCallback, useRef, useState } from 'react'
import { useLatest } from '../hooks/useLatest'
import { useOnUnmount } from '../hooks/useOnUnmount'
import { useReaction } from '../hooks/useReaction'
import { useTimers } from '../hooks/useTimers'
import { errorMessage } from '../lib/format'
import type { SendEmailRequest } from '../../../shared/types'

type AutosaveFields = SendEmailRequest

const AUTOSAVE_DEBOUNCE_MS = 1200
const AUTOSAVE_TIMER = 'autosave'

export interface DraftAutosave {
  flushPending: () => Promise<void>
  suspend: () => void
  resume: () => void
  stop: () => void
  currentDraftId: () => string | undefined
  status: 'idle' | 'saving' | 'saved'
  error: string | null
}

export function useDraftAutosave(
  fields: AutosaveFields,
  initialDraftId: string | undefined,
  enabled: boolean
): DraftAutosave {
  const [status, setStatus] = useState<DraftAutosave['status']>('idle')
  const [error, setError] = useState<string | null>(null)

  const fieldsRef = useLatest(fields)
  const draftIdRef = useRef(initialDraftId)
  const lastSavedRef = useRef(JSON.stringify(fields))
  const enabledRef = useLatest(enabled)
  const retiredRef = useRef(false)
  const suspendedRef = useRef(false)
  const pendingSaveRef = useRef<Promise<void> | null>(null)
  const timers = useTimers()
  const fieldsJson = JSON.stringify(fields)

  const save = useCallback((): Promise<void> => {
    const prior = pendingSaveRef.current ?? Promise.resolve()
    const run = prior
      .then(() => {
        if (retiredRef.current || suspendedRef.current) return
        const written = JSON.stringify(fieldsRef.current)
        if (written === lastSavedRef.current) return
        return window.api
          .saveDraft({
            ...fieldsRef.current,
            ...(draftIdRef.current ? { draftId: draftIdRef.current } : {})
          })
          .then((draftId) => {
            draftIdRef.current = draftId
            lastSavedRef.current = written
            setStatus('saved')
            setError(null)
          })
      })
      .catch((e: unknown) => {
        setStatus('idle')
        setError(errorMessage(e))
      })
      .finally(() => {
        if (pendingSaveRef.current === run) pendingSaveRef.current = null
      })
    pendingSaveRef.current = run
    setStatus('saving')
    return run
  }, [fieldsRef])

  useReaction([fieldsJson, enabled], () => {
    timers.cancel(AUTOSAVE_TIMER)
    if (!enabled || retiredRef.current) return
    timers.start(AUTOSAVE_TIMER, AUTOSAVE_DEBOUNCE_MS, () => {
      if (fieldsJson === lastSavedRef.current) return
      void save()
    })
  })

  useOnUnmount(() => {
    timers.cancel(AUTOSAVE_TIMER)
    if (!enabledRef.current || retiredRef.current) return
    if (JSON.stringify(fieldsRef.current) === lastSavedRef.current) return
    void save()
  })

  return {
    flushPending: async (): Promise<void> => {
      timers.cancel(AUTOSAVE_TIMER)
      await pendingSaveRef.current
    },
    stop: (): void => {
      retiredRef.current = true
      timers.cancel(AUTOSAVE_TIMER)
    },
    suspend: (): void => {
      timers.cancel(AUTOSAVE_TIMER)
      suspendedRef.current = true
    },
    resume: (): void => {
      suspendedRef.current = false
    },
    currentDraftId: (): string | undefined => (retiredRef.current ? undefined : draftIdRef.current),
    status,
    error
  }
}
