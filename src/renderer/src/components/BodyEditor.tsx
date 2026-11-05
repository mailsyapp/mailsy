import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react'
import { imageToPayload } from '../lib/attachmentFile'

// The compose body across all three composer surfaces: one rich-text field
// where a line of text, a dropped screenshot, and another line of text all
// live in place — Gmail's inline-image behavior. Dropping or pasting image
// files inserts them into the text the way the paste marked them up;
// non-image files never land here (the composer's drop routing sends them
// to the attachment chips).
//
// The box is uncontrolled after mount: React re-renders never rewrite it
// (rewriting would move the caret), so composers hand it a `key` when the
// prefill identity changes instead. Every input reports the content in its
// two forms at once — the html the send/autosave rides, and the plain text
// fallback — through a single `onChange`.
export interface BodyEditorHandle {
  // File-drop routing that lands outside the editor's own surface (on the
  // composer chrome) still wants its images here; inserts at the box's end.
  insertImages: (files: File[]) => Promise<void>
}

type BodyEditorProps = {
  // The rich content the box starts with (prefilled drafts, reply quotes).
  initialHtml: string
  placeholder?: string
  onChange: (content: { html: string; text: string }) => void
  // Files dropped or pasted here that are not images never stay in the
  // editor: the callback forwards them to the composer's chip routing.
  onNonImageFiles: (files: File[]) => void
}

function readContent(editor: HTMLDivElement): { html: string; text: string } {
  return { html: editor.innerHTML, text: editor.innerText }
}

function insertDataUrlAtCaret(editor: HTMLDivElement, dataUrl: string): void {
  const img = document.createElement('img')
  img.src = dataUrl
  const selection = window.getSelection()
  // A caret inside the box inserts at the caret; a collapsed or foreign
  // selection (clicking Send first, paste routing from outside) appends.
  if (
    selection &&
    selection.rangeCount > 0 &&
    editor.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    const range = selection.getRangeAt(0)
    range.deleteContents()
    range.insertNode(img)
  } else {
    editor.appendChild(img)
  }
  // Collapse the caret after the image so typing continues where it landed.
  const after = document.createRange()
  after.setStartAfter(img)
  after.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(after)
}

export const BodyEditor = forwardRef<BodyEditorHandle, BodyEditorProps>(function BodyEditor(
  { initialHtml, placeholder, onChange, onNonImageFiles },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null)

  // One-time prefill only: the uncontrolled box must not be rewritten on
  // re-render (caret death). Composers remount via key when prefill changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (initialHtml) editor.innerHTML = initialHtml
    // The initial content counts as the first input: the composers' state
    // starts in sync with what the box shows.
    onChange(readContent(editor))
    // Report once even when the editor never receives an input event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      insertImages: async (files: File[]) => {
        const editor = editorRef.current
        if (!editor) return
        for (const file of files) {
          const payload = await imageToPayload(file)
          if (payload)
            insertDataUrlAtCaret(editor, `data:${payload.mimeType};base64,${payload.base64}`)
        }
        editor.focus()
        onChange(readContent(editor))
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  async function handleDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    // Claimed synchronously: the composer's own form-level drop handler
    // runs during bubbling, before this async continuation resumes, and it
    // would route the same image back in — a double insert. Claiming the
    // event here is also why non-image leftovers hand off explicitly below.
    event.stopPropagation()
    const editor = event.currentTarget
    // The image lands where the drag let go, not at the stale caret.
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY)
      if (range) {
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      }
    }
    const files = Array.from(event.dataTransfer.files)
    const leftovers: File[] = []
    for (const file of files) {
      const payload = await imageToPayload(file)
      if (payload) insertDataUrlAtCaret(editor, `data:${payload.mimeType};base64,${payload.base64}`)
      else leftovers.push(file)
    }
    // Non-image files keep their chip routing through the composer's own
    // addFiles; the synchronous stopPropagation above is what makes this
    // handoff necessary.
    if (leftovers.length) onNonImageFiles(leftovers)
    editor.focus()
    onChange(readContent(editor))
  }

  return (
    <div
      ref={editorRef}
      className="body-editor"
      role="textbox"
      aria-multiline="true"
      aria-label="Message"
      data-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => onChange(readContent(event.currentTarget))}
      onDrop={(event) => void handleDrop(event)}
      // A pasted screenshot is the same image-in-text the drop is.
      onPaste={(event) => {
        const editor = event.currentTarget
        const files = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/')
        )
        if (files.length === 0) return
        event.preventDefault()
        void Promise.all(files.map(imageToPayload)).then((payloads) => {
          for (const payload of payloads) {
            if (payload)
              insertDataUrlAtCaret(editor, `data:${payload.mimeType};base64,${payload.base64}`)
          }
          editor.focus()
          onChange(readContent(editor))
        })
      }}
      // A plain Enter inserts a line break node, not a new div; the html
      // stays flat enough to round-trip as the same document.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          document.execCommand('insertLineBreak')
          onChange(readContent(event.currentTarget))
        }
      }}
    />
  )
})
