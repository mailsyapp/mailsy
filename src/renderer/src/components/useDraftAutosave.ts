import { useCallback, useEffect, useRef, useState } from 'react'
import type { SendEmailRequest } from '../../../shared/types'

// The composer fields the bridge persists. The optional send fields ride
// along for drafts that already carry threading (an existing draft keeps
// its linkage when the autosave updates it).
type AutosaveFields = SendEmailRequest

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
  // The latest write on the bridge; flushPending awaits it. The unmount
  // flush may start a second write before the first resolves, so runs
  // supersede by identity rather than assuming a single in-flight write.
  const pendingSaveRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<number | null>(null)
  // Serialized per render: the debounce key is the content, so unrelated
  // re-renders (a poll fold-in, a send-error state flip) re-run the effect
  // without restarting a save that was already going to be a no-op.
  const fieldsJson = JSON.stringify(fields)

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
        // A newer save may have superseded this run: only the latest write
        // owns the flushPending handle.
        if (pendingSaveRef.current === run) pendingSaveRef.current = null
      })
    pendingSaveRef.current = run
    setStatus('saving')
    return run
  }, [])

  useEffect(() => {
    fieldsRef.current = fields
    enabledRef.current = enabled
    if (!enabled || retiredRef.current) return
    if (fieldsJson === lastSavedRef.current) return
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
    // fieldsJson is the debounce key: field-object identity flips every
    // render, but its content is what distinguishes a fresh edit from a
    // rerender of unchanged values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsJson, enabled, save])

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
      // A save may already be in flight from the debounce; this fires a
      // second one for fields typed after it dispatched. Sequential IPC
      // delivery makes the newer write the last drafts.update applied.
      void save()
    }
  }, [save])

  return {
    flushPending: async (): Promise<void> => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // Await the in-flight write itself, not the ref object: a ref has no
      // `then`, so awaiting it would resolve before the save does and send
      // would read currentDraftId() while the drafts.create still flew.
      await pendingSaveRef.current
    },
    stop: (): void => {
      retiredRef.current = true
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    currentDraftId: (): string | undefined =>
      // Retired after send or Cancel: the draft was consumed or discarded,
      // so it no longer exists for any later write to target.
      (retiredRef.current ? undefined : draftIdRef.current),
    status,
    error
  }
}
