import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveDraftRequest } from '../../../shared/types'

// The composer fields the bridge persists. The optional send fields ride
// along for drafts that already carry threading (an existing draft keeps
// its linkage when the autosave updates it).
type AutosaveFields = Omit<SaveDraftRequest, 'draftId'>

// How long a keystroke pauses before its fields reach the drafts bridge:
// one Gmail drafts call per settled edit, not per character.
const AUTOSAVE_DEBOUNCE_MS = 1200

export interface DraftAutosave {
  // Synchronizer for the send path: cancels the pending debounce and waits
  // out any write already on the bridge, so send can never race a
  // straggling update into the draft it is about to consume.
  flushPending: () => Promise<void>
  // Freezes autosave after a terminal action (send consumed the draft,
  // Cancel discarded it): the pending timer and the unmount flush stand
  // down instead of writing to a retired draft id.
  stop: () => void
  currentDraftId: () => string | undefined
  status: 'idle' | 'saving' | 'saved'
  error: string | null
}

// Bridge-backed autosave for one composer. The first write creates a real
// Gmail draft; every later write updates it, and the resolved draft id
// stays in the hook so the send path consumes exactly that draft. Content
// lives in the composer's own controlled state: a failed write surfaces as
// `error` and never touches the fields, so autosave can't silently discard
// user text.
export function useDraftAutosave(
  fields: AutosaveFields,
  initialDraftId: string | undefined,
  enabled: boolean
): DraftAutosave {
  const [status, setStatus] = useState<DraftAutosave['status']>('idle')
  const [error, setError] = useState<string | null>(null)

  const fieldsRef = useRef(fields)
  const draftIdRef = useRef(initialDraftId)
  // The serialized fields already on the draft: unchanged renders and
  // untouched composers never schedule a write.
  const lastSavedRef = useRef(JSON.stringify(fields))
  const enabledRef = useRef(enabled)
  const retiredRef = useRef(false)
  // Set while a save rides the bridge; only one write is ever in flight.
  const pendingSaveRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<number | null>(null)

  // Resolves whether the write failed or not: flushPending is a
  // synchronization point for send, not a retry surface.
  const save = useCallback((): Promise<void> => {
    const run = window.api
      .saveDraft({
        ...fieldsRef.current,
        ...(draftIdRef.current ? { draftId: draftIdRef.current } : {})
      })
      .then((draftId) => {
        draftIdRef.current = draftId
        lastSavedRef.current = JSON.stringify(fieldsRef.current)
        setStatus('saved')
        setError(null)
      })
      .catch((e: unknown) => {
        setStatus('idle')
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        pendingSaveRef.current = null
      })
    pendingSaveRef.current = run
    setStatus('saving')
    return run
  }, [])

  useEffect(() => {
    fieldsRef.current = fields
    enabledRef.current = enabled
    if (!enabled || retiredRef.current) return
    if (JSON.stringify(fields) === lastSavedRef.current) return
    const timer = window.setTimeout(() => {
      timerRef.current = null
      if (JSON.stringify(fieldsRef.current) === lastSavedRef.current) return
      void save()
    }, AUTOSAVE_DEBOUNCE_MS)
    timerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      timerRef.current = null
    }
  }, [fields, enabled, save])

  // True unmount only: the accidental-close path (row click, folder
  // switch) flushes fields still inside the debounce window, because that
  // content is the whole point of autosave. An explicit Cancel sets the
  // retired flag first, so a discarded draft is never rewritten here.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (!enabledRef.current || retiredRef.current) return
      if (JSON.stringify(fieldsRef.current) === lastSavedRef.current) return
      if (!pendingSaveRef.current) void save()
    }
  }, [save])

  return {
    flushPending: async (): Promise<void> => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      await pendingSaveRef
    },
    stop: (): void => {
      retiredRef.current = true
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    currentDraftId: (): string | undefined => draftIdRef.current,
    status,
    error
  }
}
