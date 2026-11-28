import { useRef, useState } from 'react'
import { useLatest } from '../hooks/useLatest'
import { useReaction } from '../hooks/useReaction'
import { useOnUnmount } from '../hooks/useOnUnmount'
import { useTimers } from '../hooks/useTimers'
import { errorMessage } from '../lib/format'
import type {
  DraftVersion,
  SaveDraftRequest,
  SaveDraftResult,
  SendDraftRequest
} from '../../../shared/types'
type AutosaveFields = Omit<SaveDraftRequest, 'draftId' | 'expectedMessageId' | 'copyOnConflict'>
const AUTOSAVE_DEBOUNCE_MS = 1200
const STALE_REFS_ERROR = 'Reload this draft before saving further unresolved attachments.'
export interface DraftAutosave {
  flushPending: () => Promise<void>
  saveForSend: (
    snapshot: AutosaveFields
  ) => Promise<Pick<SendDraftRequest, 'draftId' | 'expectedMessageId'>>
  suspend: () => void
  resume: () => void
  stop: () => void
  currentDraft: () => Pick<SendDraftRequest, 'draftId' | 'expectedMessageId'> | undefined
  status: 'idle' | 'saving' | 'saved'
  error: string | null
  refsStale: boolean
}
export function useDraftAutosave(
  fields: AutosaveFields,
  initialDraft: DraftVersion | undefined,
  enabled: boolean,
  sessionSignal: AbortSignal,
  hasEdits = true,
  onSaved?: (result: SaveDraftResult) => void
): DraftAutosave {
  const [status, setStatus] = useState<DraftAutosave['status']>('idle')
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useLatest(fields)
  const draftRef = useRef<Pick<SaveDraftResult, 'draftId' | 'messageId'> | undefined>(initialDraft)
  const staleRefsRef = useRef(false)
  const [refsStale, setRefsStale] = useState(false)
  const onSavedRef = useLatest(onSaved)
  const lastSavedRef = useRef(JSON.stringify(fields))
  const enabledRef = useLatest(enabled && hasEdits)
  const retiredRef = useRef(false)
  const suspendedRef = useRef(false)
  const pendingSaveRef = useRef<Promise<void> | null>(null)
  const timers = useTimers()
  const fieldsJson = JSON.stringify(fields)
  function save(copyOnConflict = false, sendSnapshot?: AutosaveFields): Promise<void> {
    const prior = pendingSaveRef.current ?? Promise.resolve()
    const run = prior
      .catch(() => {})
      .then(() => {
        if (sessionSignal.aborted || retiredRef.current || suspendedRef.current) return
        const writtenFields = sendSnapshot ?? fieldsRef.current
        const written = JSON.stringify(writtenFields)
        if (written === lastSavedRef.current && (!sendSnapshot || draftRef.current)) return
        if (staleRefsRef.current && writtenFields.retainAttachments?.refs.length)
          throw new Error(STALE_REFS_ERROR)
        const target = draftRef.current
        setStatus('saving')
        return window.api
          .saveDraft({
            ...writtenFields,
            ...(target ? { draftId: target.draftId, expectedMessageId: target.messageId } : {}),
            ...(copyOnConflict ? { copyOnConflict } : {})
          })
          .then((draft) => {
            draftRef.current = draft
            staleRefsRef.current = !!draft.refsStale
            setRefsStale(!!draft.refsStale)
            if (draft.refsStale) {
              lastSavedRef.current = written
              if (writtenFields.retainAttachments?.refs.length) throw new Error(STALE_REFS_ERROR)
              setStatus('saved')
              setError(null)
              return
            }
            const rebase = (value: AutosaveFields): AutosaveFields => {
              if (
                !value.retainAttachments ||
                value.retainAttachments.messageId !== writtenFields.retainAttachments?.messageId
              )
                return value
              return {
                ...value,
                retainAttachments: {
                  messageId: draft.messageId,
                  refs: value.retainAttachments.refs.map(
                    (ref) =>
                      draft.retainedAttachments.find(
                        (entry) => entry.previousAttachmentId === ref.attachmentId
                      )?.ref ?? ref
                  )
                }
              }
            }
            fieldsRef.current = rebase(fieldsRef.current)
            lastSavedRef.current = JSON.stringify(rebase(writtenFields))
            onSavedRef.current?.(draft)
            setStatus('saved')
            setError(null)
          })
      })
      .catch((e: unknown) => {
        setStatus('idle')
        if (sendSnapshot) throw e
        setError(errorMessage(e))
      })
      .finally(() => {
        if (pendingSaveRef.current === run) pendingSaveRef.current = null
      })
    pendingSaveRef.current = run
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
  function currentDraft(): ReturnType<DraftAutosave['currentDraft']> {
    const draft = draftRef.current
    return !retiredRef.current && draft
      ? { draftId: draft.draftId, expectedMessageId: draft.messageId }
      : undefined
  }
  return {
    flushPending: async (): Promise<void> => {
      timers.cancel('autosave')
      await pendingSaveRef.current
    },
    saveForSend: async (snapshot) => {
      timers.cancel('autosave')
      await save(false, snapshot)
      const target = currentDraft()
      if (!target || sessionSignal.aborted) throw new Error('Draft could not be saved for sending.')
      return target
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
    currentDraft,
    status,
    error,
    refsStale
  }
}
