import { forwardRef, useImperativeHandle, useRef } from 'react'
import { BodyEditor, type BodyEditorHandle } from './BodyEditor'
import { AttachmentChips } from './AttachmentChips'
import type { ComposerAttachments } from './useComposerAttachments'

// The composer's content unit: the message label with the rich body and
// the chip row beneath it, wired to one attachment set. All three surfaces
// render this unit, so the body field, the chips row, and their routing
// rule live here instead of once per form: image files dropped inside the
// editor stay in the text, image files dropped on the composer chrome
// insert through the handle (the hook routes them here via its own ref),
// and non-image leftovers hand back to the chips through `addFiles`.
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
}

export const ComposerBody = forwardRef<ComposerBodyHandle, ComposerBodyProps>(function ComposerBody(
  { attach, onBodyChange, initialHtml, remountKey },
  ref
) {
  const editorRef = useRef<BodyEditorHandle | null>(null)
  // Reads through the ref at call time: the editor can remount (remountKey)
  // without this handle ever going stale.
  useImperativeHandle(
    ref,
    () => ({
      insertImages: (files) => editorRef.current?.insertImages(files) ?? Promise.resolve()
    }),
    []
  )
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
          onChange={onBodyChange}
        />
      </label>
      <AttachmentChips attach={attach} />
    </>
  )
})
