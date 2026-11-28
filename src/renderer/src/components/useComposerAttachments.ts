import { useCallback, useMemo, useRef, useState } from 'react'
import { useOnMount } from '../hooks/useOnMount'
import { useOnUnmount } from '../hooks/useOnUnmount'
import type { RefObject } from 'react'
import { errorMessage } from '../lib/format'
import {
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  attachmentsLimitError,
  decodedAttachmentBytes,
  type ComposeAttachment,
  type MessageAttachmentRef,
  type SaveDraftRequest,
  type SaveDraftResult,
  type SendEmailRequest
} from '../../../shared/types'
import { dragsFiles, fileToAttachment, looksLikeImageFile } from '../lib/attachmentFile'

export interface ComposerAttachments {
  attachments: ComposeAttachment[]
  field: Pick<SendEmailRequest, 'attachments'>
  retained: Pick<SaveDraftRequest, 'retainAttachments'>
  adoptSaved: (result: SaveDraftResult) => void
  error: string | null
  ready: boolean
  edited: boolean
  loading: boolean
  failed: MessageAttachmentRef[]
  retry: (attachmentId: string) => Promise<void>
  removeFailed: (attachmentId: string) => void
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
function blockFileDrag(event: React.DragEvent): void {
  if (dragsFiles(event)) event.preventDefault()
}
export const BLOCKED_DROP: DragHandlers = {
  onDragEnter: blockFileDrag,
  onDragOver: blockFileDrag,
  onDragLeave: () => {},
  onDrop: blockFileDrag
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
  const [edited, setEdited] = useState(false)
  const [picking, setPicking] = useState(false)
  const [loading, setLoading] = useState(Boolean(prefill?.refs.length))
  const [failed, setFailed] = useState<MessageAttachmentRef[]>([])
  const [unresolved, setUnresolved] = useState(prefill?.refs ?? [])
  const ready = !loading && failed.length === 0
  const attachmentsRef = useRef<ComposeAttachment[]>([])
  const mountedRef = useRef(false)
  const [messageId, setMessageId] = useState(prefill?.messageId)
  const messageIdRef = useRef(messageId)
  const aliasesRef = useRef(new Map<string, { messageId: string; ref: MessageAttachmentRef }>())
  const [dropping, setDropping] = useState(false)

  const dropDepth = useRef(0)
  const replaceAttachments = useCallback((next: ComposeAttachment[]): void => {
    attachmentsRef.current = next
    setAttachments(next)
  }, [])
  const loadOriginals = useCallback(
    async (refs: MessageAttachmentRef[], isAlive: () => boolean): Promise<void> => {
      const messageId = messageIdRef.current
      if (!messageId) return
      const results = await Promise.all(
        refs.map(async (ref) => {
          try {
            const data = await window.api.getAttachment(messageId, ref.attachmentId)
            return {
              ref,
              attachment: { filename: ref.filename, size: ref.size, data },
              failed: null
            }
          } catch {
            return { ref, attachment: null, failed: ref }
          }
        })
      )
      if (!isAlive()) return
      for (const result of results) {
        result.ref =
          aliasesRef.current.get(`${messageId}~${result.ref.attachmentId}`)?.ref ?? result.ref
        if (result.failed) result.failed = result.ref
      }
      replaceAttachments([
        ...attachmentsRef.current,
        ...results.flatMap((result) => (result.attachment ? [result.attachment] : []))
      ])
      setFailed((prev) => [
        ...prev.filter(
          (ref) => !results.some((attempt) => attempt.ref.attachmentId === ref.attachmentId)
        ),
        ...results.flatMap((result) => (result.failed ? [result.failed] : []))
      ])
      setUnresolved((prev) =>
        prev.filter(
          (ref) =>
            !results.some(
              (result) => result.attachment && result.ref.attachmentId === ref.attachmentId
            )
        )
      )
      setError(null)
      setLoading(false)
    },
    [replaceAttachments]
  )
  const adoptSaved = useCallback((result: SaveDraftResult): void => {
    if (!mountedRef.current || result.refsStale) return
    for (const { previousAttachmentId, ref } of result.retainedAttachments) {
      for (const [key, value] of aliasesRef.current) {
        if (
          value.messageId === result.previousMessageId &&
          value.ref.attachmentId === previousAttachmentId
        )
          aliasesRef.current.set(key, { messageId: result.messageId, ref })
      }
      aliasesRef.current.set(`${result.previousMessageId}~${previousAttachmentId}`, {
        messageId: result.messageId,
        ref
      })
    }
    const remap = (ref: MessageAttachmentRef): MessageAttachmentRef =>
      result.retainedAttachments.find((entry) => entry.previousAttachmentId === ref.attachmentId)
        ?.ref ?? ref
    messageIdRef.current = result.messageId
    setMessageId(result.messageId)
    setUnresolved((prev) => prev.map(remap))
    setFailed((prev) => prev.map(remap))
  }, [])
  useOnMount((isMounted) => {
    mountedRef.current = true
    if (prefill?.refs.length) void loadOriginals(prefill.refs, isMounted)
  })
  useOnUnmount(() => {
    mountedRef.current = false
  })
  const retry = useCallback(
    async (attachmentId: string): Promise<void> => {
      const ref = failed.find((entry) => entry.attachmentId === attachmentId)
      if (loading || !ref) return
      setLoading(true)
      await loadOriginals([ref], () => mountedRef.current)
    },
    [failed, loading, loadOriginals]
  )
  const removeFailed = useCallback(
    (attachmentId: string): void => {
      if (loading) return
      setFailed((prev) => prev.filter((ref) => ref.attachmentId !== attachmentId))
      setUnresolved((prev) => prev.filter((ref) => ref.attachmentId !== attachmentId))
      setError(null)
      setEdited(true)
    },
    [loading]
  )
  const push = useCallback(
    (incoming: ComposeAttachment[]): void => {
      if (incoming.length === 0) return
      const joinedBytes =
        attachmentsRef.current.reduce(
          (sum, attachment) => sum + decodedAttachmentBytes(attachment),
          0
        ) + incoming.reduce((sum, attachment) => sum + decodedAttachmentBytes(attachment), 0)
      if (joinedBytes > ATTACHMENTS_TOTAL_LIMIT_BYTES) {
        setError(attachmentsLimitError(joinedBytes))
        return
      }
      replaceAttachments([...attachmentsRef.current, ...incoming])
      setEdited(true)
    },
    [replaceAttachments]
  )
  const pick = useCallback(async (): Promise<void> => {
    if (picking || !ready) return
    setPicking(true)
    setError(null)
    try {
      push(await window.api.pickAttachments())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPicking(false)
    }
  }, [picking, push, ready])
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
  const remove = useCallback(
    (index: number) => {
      replaceAttachments(attachmentsRef.current.filter((_, i) => i !== index))
      setEdited(true)
    },
    [replaceAttachments]
  )
  const clear = useCallback(() => {
    replaceAttachments([])
    setFailed([])
    setUnresolved([])
    setError(null)
  }, [replaceAttachments])
  const field: Pick<SendEmailRequest, 'attachments'> = attachments.length > 0 ? { attachments } : {}
  return {
    attachments,
    field,
    retained:
      unresolved.length && messageId ? { retainAttachments: { messageId, refs: unresolved } } : {},
    adoptSaved,
    error: failed.length
      ? `Could not load: ${failed.map((ref) => ref.filename).join(', ')}`
      : error,
    ready,
    edited,
    loading,
    failed,
    retry,
    removeFailed,
    picking,
    dropping,
    drop,
    pick,
    addFiles,
    remove,
    clear
  }
}
