import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react'
import { imageToPayload, looksLikeImageFile } from '../lib/attachmentFile'

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

// Reads the box in its two forms. A box that holds nothing but placeholder
// line breaks (the engine keeps one when its last text is deleted) reports
// the empty html `''`: empty is empty, both for sends and for what the
// placeholder shows.
function readContent(editor: HTMLDivElement): { html: string; text: string } {
  const html = editor.innerHTML
  const text = editor.innerText
  return { html: /^(\s|<br\/?>)*$/i.test(html) ? '' : html, text }
}

// True when the box shows no content a user would see: whitespace-only
// text nodes and marker <br>s aside. Drives the placeholder attribute —
// `:empty` cannot, because the engine's kept <br> makes the box not-empty
// while looking empty.
function isVisuallyEmpty(editor: HTMLDivElement): boolean {
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') continue
    if (node.nodeName === 'BR') continue
    return false
  }
  return true
}

// Reports the box to the composer. Deferred out of the engine's edit
// transaction on purpose: reading innerText (every report does layout)
// synchronously during `input` makes Chromium abort a pending
// deleteContentBackward over a trailing <br> — Backspace then cannot
// remove line breaks. A macrotask boundary is what separates the
// transaction: microtasks still run inside the keystroke's task.
function reportLater(editor: HTMLDivElement, onChange: BodyEditorProps['onChange']): void {
  setTimeout(() => {
    editor.toggleAttribute('data-empty', isVisuallyEmpty(editor))
    onChange(readContent(editor))
  }, 0)
}

// Whitespace text and the engine's marker <br>s do not count as content
// when walking a block chain.
function isBlankNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').trim() === ''
  if (node.nodeName === 'BR') return true
  return false
}

function isBlockElement(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    !getComputedStyle(node as Element).display.startsWith('inline')
  )
}

function removeNode(node: Node): void {
  ;(node as ChildNode).remove()
}

function placeCaret(
  editor: HTMLDivElement,
  selection: Selection,
  container: Node,
  index: number
): void {
  const placed = document.createRange()
  placed.setStart(container, index)
  placed.collapse(true)
  selection.removeAllRanges()
  selection.addRange(placed)
  editor.focus()
}

// Chromium's Backspace no-ops in positions mail bodies are full of — the
// vanilla-contenteditable probes confirmed it is engine behavior, not the
// editor's: right behind a line-break marker (the box keeps one once the
// last character is deleted), between blank markers and a following block
// (a reply quote starts exactly like that), and at the box's very start
// with the quote block ahead. This handler supplies the missing deletes at
// the engine's own granularity — one visible unit per keystroke: a marker,
// one merge across a block seam, or the following block when nothing is
// left behind the caret (how backspacing through a quote reads). It
// returns whether it handled the keystroke.
function mergeBackward(editor: HTMLDivElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false

  // Caret right behind a line-break marker: remove the marker. The engine
  // stalls even when ordinary text follows, and removing the marker is
  // exactly what the engine itself does in the positions it handles.
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const container = range.startContainer
    const index = range.startOffset
    const before = index > 0 ? container.childNodes[index - 1] : null
    if (before && before.nodeName === 'BR') {
      removeNode(before)
      placeCaret(editor, selection, container, index - 1)
      return true
    }
  }

  if (range.startOffset !== 0) return false
  const start = range.startContainer
  const caretElement = start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element)
  if (!caretElement || caretElement === editor) return eatAheadUnit(editor, selection)

  // The caret must sit at the start of its whole chain inside the box: no
  // visible content in any ancestor level before it. Content siblings
  // anywhere make this an ordinary deletion, which the engine handles.
  let probe: Node | null = caretElement
  let anchor: Node | null = null
  while (probe && probe !== editor) {
    if (probe.previousSibling && anchor === null) anchor = probe
    let sibling: Node | null = probe.previousSibling
    while (sibling) {
      if (!isBlankNode(sibling)) return false
      sibling = sibling.previousSibling
    }
    probe = probe.parentElement
  }
  if (!anchor) return eatAheadUnit(editor, selection)

  const anchorParent = anchor.parentElement as HTMLElement
  // The empty-line markers between the anchor and the preceding content:
  // collected so a merge can clear the seam without orphaning lines.
  const blanksBefore: Node[] = []
  let content: Node | null = null
  let sibling: Node | null = anchor.previousSibling
  while (sibling) {
    if (!isBlankNode(sibling)) {
      content = sibling
      break
    }
    blanksBefore.unshift(sibling)
    sibling = sibling.previousSibling
  }

  if (!content) {
    // Only blank markers precede the anchor: eat the one nearest the
    // anchor (the engine's own blank-marker deletion, one per press).
    if (blanksBefore.length === 0) return false
    removeNode(blanksBefore[blanksBefore.length - 1])
    return true
  }

  if (isBlockElement(content)) {
    // Merge: the anchor's children move into the preceding block's end;
    // the blank markers between them leave with the boundary. The caret
    // lands on the seam — the engine's deleting continues from there.
    const target = content as HTMLElement
    const moved = Array.from(anchor.childNodes)
    for (const blank of blanksBefore) removeNode(blank)
    for (const child of moved) target.appendChild(child)
    removeNode(anchor)
    const seam = target.childNodes.length - moved.length
    placeCaret(editor, selection, target, seam >= 0 ? seam : target.childNodes.length)
    return true
  }

  // A text or inline neighbor: unwrap the anchor into its own level. Its
  // children take its place after the blank markers (which the user has
  // not deleted yet), and the next presses operate normally from there.
  const moved = Array.from(anchor.childNodes)
  const anchorIndex = Array.prototype.indexOf.call(anchorParent.childNodes, anchor)
  for (const child of moved) anchorParent.insertBefore(child, anchor)
  removeNode(anchor)
  placeCaret(editor, selection, anchorParent, anchorIndex)
  return true
}

// At the box's very start nothing sits behind the caret, so Backspace
// there is a legitimate no-op for plain text — the engine's no-op stands.
// When, however, blank markers and a block element follow the caret (the
// reply quote opens with exactly `<br><br><div class=gmail_quote…>`), the
// quote eats from its front: one marker per press until none are left,
// then the block itself. Any text or inline content met before a block
// calls the whole thing off — a delete-before start must stay inert.
function eatAheadUnit(editor: HTMLDivElement, selection: Selection): boolean {
  if (selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  const container = range.startContainer
  if (container.nodeType === Node.TEXT_NODE && (container.textContent ?? '').length > 0)
    return false

  // The unit queue: blank markers met while walking toward the first
  // block; one leaves per keystroke, so the press cadence matches the
  // visible line structure.
  const markers: Node[] = []
  let node: Node = container
  let first = true
  while (true) {
    // The scan stays inside the box: climbing past it would sight the
    // composer's chrome (attachment bar, actions row) as "content ahead",
    // and the body's keystrokes must never eat the composer.
    let follower: Node | null = null
    if (node === editor) {
      if (!first) return false
      follower = (container as Element).childNodes[range.startOffset] ?? null
    } else {
      follower = first
        ? container.nodeType === Node.ELEMENT_NODE
          ? ((container as Element).childNodes[range.startOffset] ?? null)
          : container.nextSibling
        : node.nextSibling
    }
    while (follower) {
      if (follower.nodeType === Node.TEXT_NODE) {
        // Whitespace between markers is eatable alongside them; visible
        // text ahead means a plain delete-before start — stop claiming.
        if ((follower.textContent ?? '').trim() !== '') return false
      } else if (follower.nodeName === 'BR') {
        markers.push(follower)
      } else if (isBlockElement(follower)) {
        const eaten = markers.shift() ?? follower
        const parent = eaten.parentElement
        if (!parent) return false
        const slot = Array.prototype.indexOf.call(parent.childNodes, eaten)
        removeNode(eaten)
        placeCaret(editor, selection, parent, slot)
        return true
      } else {
        // An inline element ahead: the engine's own delete-before stands.
        return false
      }
      follower = follower.nextSibling
    }
    if (node === editor) return false
    first = false
    node = node.parentElement as Node
  }
}

// Reports the box to the composer right away: the imperative paths (drop,
// paste, insertImages) change the DOM outside any input event, so both the
// content and the data-empty marker must be re-derived here or the
// placeholder would linger over a box that now holds an image.
function reportNow(editor: HTMLDivElement, onChange: BodyEditorProps['onChange']): void {
  editor.toggleAttribute('data-empty', isVisuallyEmpty(editor))
  onChange(readContent(editor))
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

// One insertion path for every way an image file enters this box: dropped
// at the caret, pasted, or inserted through the imperative handle from the
// composer chrome. Each image becomes an <img> with its data URL where the
// caret sits; anything not an image comes back to the caller for its chip
// routing.
async function insertImageFiles(editor: HTMLDivElement, files: File[]): Promise<File[]> {
  const leftovers: File[] = []
  for (const file of files) {
    const payload = await imageToPayload(file)
    if (payload) insertDataUrlAtCaret(editor, `data:${payload.mimeType};base64,${payload.base64}`)
    else leftovers.push(file)
  }
  return leftovers
}

export const BodyEditor = forwardRef<BodyEditorHandle, BodyEditorProps>(function BodyEditor(
  { initialHtml, placeholder, onChange, onNonImageFiles },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  // The imperative handle reads the current callback through this ref: the
  // handle installs once, so a stale `onChange` closure would silently
  // report into a previous render's setter otherwise.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // One-time prefill only: the uncontrolled box must not be rewritten on
  // re-render (caret death). Composers remount via key when prefill changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (initialHtml) editor.innerHTML = initialHtml
    editor.toggleAttribute('data-empty', isVisuallyEmpty(editor))
    // The stall patches (mergeBackward, eatAheadUnit) ride the plain
    // Backspace keydown: when the engine no-ops at all it may never report
    // a beforeinput to veto, and keydown is the one hook that always sees
    // the keystroke before it.
    // The initial content counts as the first input: the composers' state
    // starts in sync with what the box shows.
    onChange(readContent(editor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      insertImages: async (files: File[]) => {
        const editor = editorRef.current
        if (!editor) return
        await insertImageFiles(editor, files)
        editor.focus()
        reportNow(editor, onChangeRef.current)
      }
    }),

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
    const leftovers = await insertImageFiles(editor, files)
    // Non-image files keep their chip routing through the composer's own
    // addFiles; the synchronous stopPropagation above is what makes this
    // handoff necessary.
    if (leftovers.length) onNonImageFiles(leftovers)
    editor.focus()
    reportNow(editor, onChange)
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
      onInput={(event) => reportLater(event.currentTarget, onChange)}
      onDrop={(event) => void handleDrop(event)}
      // A pasted screenshot is the same image-in-text the drop is; the file
      // classifier is the shared module's image rule, the same one the drop
      // and the composer routing speak.
      onPaste={(event) => {
        const editor = event.currentTarget
        const files = Array.from(event.clipboardData.files).filter(looksLikeImageFile)
        if (files.length === 0) return
        event.preventDefault()
        void insertImageFiles(editor, files).then(() => {
          editor.focus()
          reportNow(editor, onChangeRef.current)
        })
      }}
      // A plain Enter inserts a line break node, not a new div; the html
      // stays flat enough to round-trip as the same document. Backspace
      // where the engine stalls (see mergeBackward) is claimed here, at
      // the one hook that always sees the keystroke ahead of the engine.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          document.execCommand('insertLineBreak')
          reportLater(event.currentTarget, onChange)
          return
        }
        if (
          event.key === 'Backspace' &&
          !event.nativeEvent.isComposing &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          mergeBackward(event.currentTarget)
        ) {
          event.preventDefault()
          reportLater(event.currentTarget, onChange)
        }
      }}
    />
  )
})
