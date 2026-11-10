import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { BodyEditorHandle } from './BodyEditor'
import { errorMessage } from '../lib/format'
import {
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  attachmentsLimitError,
  decodedAttachmentBytes,
  type ComposeAttachment,
  type MessageAttachmentRef,
  type SendEmailRequest
} from '../../../shared/types'
import { dragsFiles, fileToAttachment, looksLikeImageFile } from '../lib/attachmentFile'

// One composer's attachment set, shared by the three composer surfaces
// (new compose, draft edit, reply/forward). State lives here; the content
// rides the compose fields exactly like text, so no layer ever owns
// attachments separately. `field` is that ride: the empty-list-free
// request field every autosave and send payload spreads. `prefill` is the
// draft-editor round trip: the stored refs of the draft being edited,
// resolved to full records before `ready` flips true — an autosave that
// started earlier would replace the stored raw message and silently strip
// those files. Resolve failures surface in `error` with the missing
// names; the loaded rest still attach.
//
// Files enter through either entrance the OS offers: the native picker
// (`pick`) or a drag onto the composer (`drop`/`dropping`). Both funnel
// through the same cumulative-budget push, so the 20 MB rule holds no
// matter how files arrive.
export interface ComposerAttachments {
  attachments: ComposeAttachment[]
  field: Pick<SendEmailRequest, 'attachments'>
  error: string | null
  ready: boolean
  picking: boolean
  // True while a file drag hovers anywhere over the composer box, for the
  // dashed affordance CSS styles on `.composer-dragging`.
  dropping: boolean
  drop: DragHandlers
  pick: () => Promise<void>
  // Also the editor's handoff for non-image files dropped into the body:
  // the same chip entry point the form-level drop uses.
  addFiles: (files: File[]) => Promise<void>
  remove: (index: number) => void
  // The composer's own abandon verb: Cancel throws the files away the way
  // it discards the text, so they never leak into the next form this
  // hook's instance survives into.
  clear: () => void
}

// The four handlers spread straight onto the composer `<form>`; the depth
// counter inside makes nested children (chips, textareas) not flicker the
// highlight on the way through.
export interface DragHandlers {
  onDragEnter: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
}

export type AttachmentPrefill = {
  messageId: string
  refs: MessageAttachmentRef[]
}

// The decoded-bytes accounting is shared/types' rule (same unit the send
// boundary and the picker count). Here it sums over the hook's own set.

export function useComposerAttachments(
  prefill?: AttachmentPrefill,
  // Where image files belong: the rich body's handle. Image files dropped
  // on the composer chrome (outside the editor's own surface) insert
  // through this ref read at handler time, so the wiring carries no
  // stale-closure risk and needs no callback layer. Files-on-chips and
  // images-in-text stay separated by type, never by where the drag landed.
  bodyEditorRef?: RefObject<BodyEditorHandle | null>
): ComposerAttachments {
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [ready, setReady] = useState(!prefill || prefill.refs.length === 0)
  const [dropping, setDropping] = useState(false)
  // Nesting depth of the drag over this composer; zero means no drag is
  // hovering, and the counter beats per-element leave events that fire
  // while moving across children.
  const dropDepth = useRef(0)

  useEffect(() => {
    if (!prefill || prefill.refs.length === 0) return
    let alive = true
    Promise.all(
      prefill.refs.map(async (ref) => {
        try {
          const data = await window.api.getAttachment(prefill.messageId, ref.attachmentId)
          return { attachment: { filename: ref.filename, size: ref.size, data }, failed: null }
        } catch {
          return { attachment: null, failed: ref.filename }
        }
      })
    ).then((results) => {
      if (!alive) return
      setAttachments(results.flatMap((result) => (result.attachment ? [result.attachment] : [])))
      const failedNames = results.flatMap((result) => (result.failed ? [result.failed] : []))
      if (failedNames.length) setError(`Could not load: ${failedNames.join(', ')}`)
      setReady(true)
    })
    return () => {
      alive = false
    }
    // The refs settle once per open draft: key={detail.id} remounts the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One entrance for every way files arrive: the cumulative budget is
  // checked over the joined set, so splitting the bytes across a picker
  // and a drag cannot slip past 20 MB either.
  const push = useCallback(
    (incoming: ComposeAttachment[]): void => {
      if (incoming.length === 0) return
      const joinedBytes =
        attachments.reduce((sum, attachment) => sum + decodedAttachmentBytes(attachment), 0) +
        incoming.reduce((sum, attachment) => sum + decodedAttachmentBytes(attachment), 0)
      if (joinedBytes > ATTACHMENTS_TOTAL_LIMIT_BYTES) {
        setError(attachmentsLimitError(joinedBytes))
        return
      }
      setAttachments((prev) => [...prev, ...incoming])
    },
    [attachments]
  )

  const pick = useCallback(async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    setError(null)
    try {
      // Main rejects an over-budget pick with this same sentence; the
      // cumulative total across several picks is the renderer's own rule.
      push(await window.api.pickAttachments())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPicking(false)
    }
  }, [picking, push])

  // The drag entrance. The dropped File objects are read right here in
  // the renderer: their bytes are already on this side of the bridge, so
  // no main-process round trip exists to add one. Image files route to
  // the rich body instead of the chip list, so the same drag onto the
  // composer behaves Gmail-shaped regardless of where it lands.
  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return
      // A resolving draft's stored refs come back wholesale when they
      // land; accepting files before that would be silently overwritten,
      // so the drop says so instead.
      if (!ready) {
        setError('This draft is still loading its attachments. Try again in a moment.')
        return
      }
      setError(null)
      const loaded = await Promise.all(files.map(fileToAttachment))
      push(loaded.filter((entry): entry is ComposeAttachment => entry !== null))
    },
    [push, ready]
  )

  const drop = useMemo<DragHandlers>(
    () => ({
      onDragEnter: (event) => {
        if (!dragsFiles(event)) return
        event.preventDefault()
        dropDepth.current += 1
        setDropping(true)
      },
      onDragOver: (event) => {
        if (dragsFiles(event)) event.preventDefault()
      },
      onDragLeave: (event) => {
        if (!dragsFiles(event)) return
        dropDepth.current -= 1
        if (dropDepth.current <= 0) {
          dropDepth.current = 0
          setDropping(false)
        }
      },
      onDrop: (event) => {
        if (!dragsFiles(event)) return
        event.preventDefault()
        dropDepth.current = 0
        setDropping(false)
        const files = Array.from(event.dataTransfer.files)
        const images = files.filter((file) => looksLikeImageFile(file))
        const others = files.filter((file) => !looksLikeImageFile(file))
        if (images.length) void bodyEditorRef?.current?.insertImages(images)
        void addFiles(others)
      }
    }),
    // bodyEditorRef is a stable ref object; read at handler time.
    [addFiles, bodyEditorRef]
  )

  const remove = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = useCallback(() => {
    setAttachments([])
    setError(null)
  }, [])

  const field: Pick<SendEmailRequest, 'attachments'> = attachments.length > 0 ? { attachments } : {}

  return {
    attachments,
    field,
    error,
    ready,
    picking,
    dropping,
    drop,
    pick,
    addFiles,
    remove,
    clear
  }
}
