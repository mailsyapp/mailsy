import { useCallback, useEffect, useState } from 'react'
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
export interface ComposerAttachments {
  attachments: ComposeAttachment[]
  field: Pick<SendEmailRequest, 'attachments'>
  error: string | null
  ready: boolean
  picking: boolean
  pick: () => Promise<void>
  remove: (index: number) => void
  // The composer's own abandon verb: Cancel throws the files away the way
  // it discards the text, so they never leak into the next form this
  // hook's instance survives into.
  clear: () => void
}

export type AttachmentPrefill = {
  messageId: string
  refs: MessageAttachmentRef[]
}

// Decoded bytes, the same accounting the send boundary does.
function decodedBytes(attachment: ComposeAttachment): number {
  return Math.floor(attachment.data.length * 0.75)
}

export function useComposerAttachments(prefill?: AttachmentPrefill): ComposerAttachments {
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [ready, setReady] = useState(!prefill || prefill.refs.length === 0)

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

  const pick = useCallback(async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    setError(null)
    try {
      const picked = await window.api.pickAttachments()
      const totalBytes =
        attachments.reduce((sum, attachment) => sum + decodedBytes(attachment), 0) +
        picked.reduce((sum, attachment) => sum + decodedBytes(attachment), 0)
      // Main rejects an over-budget pick with this same sentence; the
      // cumulative total across several picks is the renderer's own rule.
      if (totalBytes > ATTACHMENTS_TOTAL_LIMIT_BYTES) {
        throw new Error(attachmentsLimitError(totalBytes))
      }
      setAttachments((prev) => [...prev, ...picked])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }, [attachments, picking])

  const remove = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = useCallback(() => {
    setAttachments([])
    setError(null)
  }, [])

  const field: Pick<SendEmailRequest, 'attachments'> = attachments.length > 0 ? { attachments } : {}

  return { attachments, field, error, ready, picking, pick, remove, clear }
}
