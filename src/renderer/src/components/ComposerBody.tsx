import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { useReaction } from '../hooks/useReaction'
import { BodyEditor, type BodyEditorHandle } from './BodyEditor'
import { AttachmentChips } from './AttachmentChips'
import { SignatureBar } from './SignatureBar'
import { loadSignature } from '../lib/signature'
import { plainTextToHtml } from '../lib/emailHtml'
import type { ComposerAttachments } from './useComposerAttachments'
export interface ComposerBodyHandle {
  read: BodyEditorHandle['read']
  insertImages: (files: File[]) => Promise<void>
}
type ComposerBodyProps = {
  attach: ComposerAttachments
  onBodyChange: (body: { html: string; text: string }, source: 'edit' | 'prefill') => void
  initialHtml?: string
  remountKey?: string | number
  autoSignature?: boolean
}
export const ComposerBody = forwardRef<ComposerBodyHandle, ComposerBodyProps>(function ComposerBody(
  { attach, onBodyChange, initialHtml, remountKey, autoSignature },
  ref
) {
  const editorRef = useRef<BodyEditorHandle | null>(null)
  const [signaturePresent, setSignaturePresent] = useState(false)
  useImperativeHandle(
    ref,
    () => ({
      read: () => editorRef.current?.read(),
      insertImages: (files) => editorRef.current?.insertImages(files) ?? Promise.resolve()
    }),
    []
  )
  const handleBodyChange = useCallback(
    (
      content: {
        html: string
        text: string
      },
      source: 'edit' | 'prefill'
    ) => {
      setSignaturePresent(editorRef.current?.hasSignatureBlock() ?? false)
      onBodyChange(content, source)
    },
    [onBodyChange]
  )
  useReaction([autoSignature, initialHtml], () => {
    if (!autoSignature) return
    if ((initialHtml ?? '').trim() !== '') return
    const stored = loadSignature()
    if (stored.trim() === '') return
    editorRef.current?.insertSignatureBlock(plainTextToHtml(stored), { focusCaret: false })
  })
  return (
    <>
      <label className="composerField composerField-grow">
        <span>Message</span>
        <BodyEditor
          key={remountKey === undefined ? undefined : String(remountKey)}
          ref={editorRef}
          initialHtml={initialHtml ?? ''}
          placeholder="Type your message..."
          onNonImageFiles={(files) => void attach.addFiles(files)}
          onChange={handleBodyChange}
        />
      </label>
      <SignatureBar editor={editorRef} present={signaturePresent} />
      <AttachmentChips attach={attach} />
    </>
  )
})
