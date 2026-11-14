import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { BodyEditor, type BodyEditorHandle } from './BodyEditor'
import { AttachmentChips } from './AttachmentChips'
import { SignatureBar } from './SignatureBar'
import { loadSignature, signatureHtml } from '../lib/signature'
import type { ComposerAttachments } from './useComposerAttachments'

// The composer's content unit: the message label with the rich body, the
// signature row, and the chip row beneath it, wired to one attachment
// set. All three surfaces render this unit, so the body field, the
// signature toggle, the chips row, and their routing rule live here
// instead of once per form: image files dropped inside the editor stay in
// the text, image files dropped on the composer chrome insert through the
// handle (the hook routes them here via its own ref), and non-image
// leftovers hand back to the chips through `addFiles`.
export interface ComposerBodyHandle {
  // The chrome-drop image insert, exposed for the hook's routing ref.
  insertImages: (files: File[]) => Promise<void>
}

type ComposerBodyProps = {
  attach: ComposerAttachments
  // Reports the box in its two forms (the html and the plain-text twin).
  onBodyChange: (body: { html: string; text: string }) => void
  // The rich prefill: a stored draft's html, or a reply/forward quote.
  initialHtml?: string
  // Optional remount key for a fresh editor on a prefill identity change —
  // the box is uncontrolled past mount, so rewriting is never an option.
  remountKey?: string | number
  // Auto-inserts the stored signature into an empty fresh body. Only the
  // new-compose surface sets this: a draft or a reply already carries its
  // own content, and prefilling more into it would be spurious text.
  autoSignature?: boolean
}

export const ComposerBody = forwardRef<ComposerBodyHandle, ComposerBodyProps>(function ComposerBody(
  { attach, onBodyChange, initialHtml, remountKey, autoSignature },
  ref
) {
  const editorRef = useRef<BodyEditorHandle | null>(null)
  // Per-message signature state, derived from the editor's DOM on every
  // content report rather than tracked by the toggle: deleting the block
  // by hand (it is ordinary body content) is as legitimate as the
  // remove button, and the button's pressed state must follow either.
  const [signaturePresent, setSignaturePresent] = useState(false)
  // Reads through the ref at call time: the editor can remount (remountKey)
  // without this handle ever going stale.
  useImperativeHandle(
    ref,
    () => ({
      insertImages: (files) => editorRef.current?.insertImages(files) ?? Promise.resolve()
    }),
    []
  )
  // One report path for every way the box changes: presence re-derives
  // here (the report lands after the DOM change — reportNow is
  // synchronous, reportLater's timer fires with the final DOM in place),
  // then the composer's own state update proceeds unchanged.
  const handleBodyChange = useCallback(
    (content: { html: string; text: string }) => {
      setSignaturePresent(editorRef.current?.hasSignatureBlock() ?? false)
      onBodyChange(content)
    },
    [onBodyChange]
  )
  // The fresh-compose auto-insert: mount-only, after the editor's own
  // mount prefill (child effects run first), so the empty body the
  // initial report saw gains its signature before the user types.
  useEffect(() => {
    if (!autoSignature) return
    const stored = loadSignature()
    if (stored.trim() === '') return
    editorRef.current?.insertSignatureBlock(signatureHtml(stored))
  }, [autoSignature])
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
