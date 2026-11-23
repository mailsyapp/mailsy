import { useCallback, useMemo, useRef, useState } from 'react'
import { useOnMount } from '../hooks/useOnMount'
import type { RefObject } from 'react'
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

export interface ComposerAttachments {
  attachments: ComposeAttachment[]
  field: Pick<SendEmailRequest, 'attachments'>
  error: string | null
  ready: boolean
  picking: boolean
  dropping: boolean
  drop: DragHandlers
  pick: () => Promise<void>
  addFiles: (files: File[]) => Promise<void>
  remove: (index: number) => void
  clear: () => void
}

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

export function useComposerAttachments(
  prefill?: AttachmentPrefill,
  bodyEditorRef?: RefObject<{
    insertImages: (files: File[]) => Promise<void>
  } | null>
): ComposerAttachments {
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [ready, setReady] = useState(!prefill || prefill.refs.length === 0)
  const [dropping, setDropping] = useState(false)
  const dropDepth = useRef(0)

  useOnMount((isMounted) => {
    if (!prefill || prefill.refs.length === 0) return
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
      if (!isMounted()) return
      setAttachments(results.flatMap((result) => (result.attachment ? [result.attachment] : [])))
      const failedNames = results.flatMap((result) => (result.failed ? [result.failed] : []))
      if (failedNames.length) setError(`Could not load: ${failedNames.join(', ')}`)
      setReady(true)
    })
  })

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
      push(await window.api.pickAttachments())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPicking(false)
    }
  }, [picking, push])

  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return
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
