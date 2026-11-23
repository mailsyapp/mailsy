import { useRef, useState } from 'react'
import { useLatest } from '../hooks/useLatest'
import { useReaction } from '../hooks/useReaction'
import { useOnUnmount } from '../hooks/useOnUnmount'
import { useTimers } from '../hooks/useTimers'
import { errorMessage } from '../lib/format'
import type { DraftVersion, SendDraftRequest, SendEmailRequest } from '../../../shared/types'
type AutosaveFields = SendEmailRequest
const AUTOSAVE_DEBOUNCE_MS = 1200
export interface DraftAutosave {
  flushPending: () => Promise<void>
  suspend: () => void
  resume: () => void
  stop: () => void
  currentDraft: () => Pick<SendDraftRequest, 'draftId' | 'expectedMessageId'> | undefined
  status: 'idle' | 'saving' | 'saved'
  error: string | null
}
export function useDraftAutosave(
  fields: AutosaveFields,
  initialDraft: DraftVersion | undefined,
  enabled: boolean,
  sessionSignal: AbortSignal,
  hasEdits = true
): DraftAutosave {
  const [status, setStatus] = useState<DraftAutosave['status']>('idle')
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useLatest(fields)
  const draftRef = useRef(initialDraft)
  const lastSavedRef = useRef(JSON.stringify(fields))
  const enabledRef = useLatest(enabled && hasEdits)
  const retiredRef = useRef(false)
  const suspendedRef = useRef(false)
  const pendingSaveRef = useRef<Promise<void> | null>(null)
  const timers = useTimers()
  const fieldsJson = JSON.stringify(fields)
  function save(copyOnConflict = false): Promise<void> {
    const prior = pendingSaveRef.current ?? Promise.resolve()
    const run = prior
      .then(() => {
        if (sessionSignal.aborted || retiredRef.current || suspendedRef.current) return
        const written = JSON.stringify(fieldsRef.current)
        if (written === lastSavedRef.current) return
        const target = draftRef.current
        return window.api
          .saveDraft({
            ...fieldsRef.current,
            ...(target ? { draftId: target.draftId, expectedMessageId: target.messageId } : {}),
            ...(copyOnConflict ? { copyOnConflict } : {})
          })
          .then((draft) => {
            draftRef.current = draft
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
  }
  useReaction([fieldsJson, enabled, hasEdits], () => {
    timers.cancel('autosave')
    if (!hasEdits) {
      lastSavedRef.current = fieldsJson
      return
    }
    if (!enabled || retiredRef.current) return
    const scheduledJson = fieldsJson
    timers.start('autosave', AUTOSAVE_DEBOUNCE_MS, () => {
      if (scheduledJson === lastSavedRef.current) return
      void save()
    })
  })
  useOnUnmount(() => {
    timers.cancel('autosave')
    if (sessionSignal.aborted || !enabledRef.current || retiredRef.current) return
    if (JSON.stringify(fieldsRef.current) === lastSavedRef.current) return
    void save(true)
  })
  return {
    flushPending: async (): Promise<void> => {
      timers.cancel('autosave')
      await pendingSaveRef.current
    },
    stop: (): void => {
      retiredRef.current = true
      timers.cancel('autosave')
    },
    suspend: (): void => {
      timers.cancel('autosave')
      suspendedRef.current = true
    },
    resume: (): void => {
      suspendedRef.current = false
    },
    currentDraft: () => {
      const draft = draftRef.current
      return !retiredRef.current && draft
        ? { draftId: draft.draftId, expectedMessageId: draft.messageId }
        : undefined
    },
    status,
    error
  }
}
