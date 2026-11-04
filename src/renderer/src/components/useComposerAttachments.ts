import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  attachmentsLimitError,
  type ComposeAttachment,
  type MessageAttachmentRef,
  type SendEmailRequest
} from '../../../shared/types'

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

// Decoded bytes, the same accounting the send boundary does.
function decodedBytes(attachment: ComposeAttachment): number {
  return Math.floor(attachment.data.length * 0.75)
}

// A dropped File carries its own bytes; renderers have no Buffer, so the
// chunked btoa walk is the standard-browser equivalent of main's
// fs.readFile + toString('base64'). Chunks stay under the argument-size
// that makes String.fromCharCode overflow.
async function fileToAttachment(file: File): Promise<ComposeAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return { filename: file.name, size: file.size, data: btoa(binary) }
}

// Only file drags count: text and url drags (a selection dragged between
// fields, a dragged link) must behave as they always did.
function dragsFiles(event: React.DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

export function useComposerAttachments(prefill?: AttachmentPrefill): ComposerAttachments {
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
        attachments.reduce((sum, attachment) => sum + decodedBytes(attachment), 0) +
        incoming.reduce((sum, attachment) => sum + decodedBytes(attachment), 0)
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }, [picking, push])

  // The drag entrance. The dropped File objects are read right here in
  // the renderer: their bytes are already on this side of the bridge, so
  // no main-process round trip exists to add one.
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
      push(await Promise.all(files.map(fileToAttachment)))
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
        void addFiles(Array.from(event.dataTransfer.files))
      }
    }),
    [addFiles]
  )

  const remove = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = useCallback(() => {
    setAttachments([])
    setError(null)
  }, [])

  const field: Pick<SendEmailRequest, 'attachments'> = attachments.length > 0 ? { attachments } : {}

  return { attachments, field, error, ready, picking, dropping, drop, pick, remove, clear }
}
