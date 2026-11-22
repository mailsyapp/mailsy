import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useAfterCurrentTask } from '../hooks/useAfterCurrentTask'
import { useLatest } from '../hooks/useLatest'
import { useOnMount } from '../hooks/useOnMount'
import { imageToPayload, looksLikeImageFile } from '../lib/attachmentFile'
import { SIGNATURE_BLOCK_CLASS, SIGNATURE_BLOCK_SELECTOR } from '../lib/signature'

export interface BodyEditorHandle {
  insertImages: (files: File[]) => Promise<void>
  insertSignatureBlock: (html: string, options?: { focusCaret?: boolean }) => void
  removeSignatureBlock: () => void
  hasSignatureBlock: () => boolean
}

type BodyEditorProps = {
  initialHtml: string
  placeholder?: string
  onChange: (content: { html: string; text: string }) => void
  onNonImageFiles: (files: File[]) => void
}

function readContent(editor: HTMLDivElement): { html: string; text: string } {
  const html = editor.innerHTML
  const text = editor.innerText
  return { html: /^(\s|<br\/?>)*$/i.test(html) ? '' : html, text }
}

function isVisuallyEmpty(editor: HTMLDivElement): boolean {
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') continue
    if (node.nodeName === 'BR') continue
    return false
  }
  return true
}

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

function mergeBackward(editor: HTMLDivElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false

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
    if (blanksBefore.length === 0) return false
    removeNode(blanksBefore[blanksBefore.length - 1])
    return true
  }

  if (isBlockElement(content)) {
    const target = content as HTMLElement
    const moved = Array.from(anchor.childNodes)
    for (const blank of blanksBefore) removeNode(blank)
    for (const child of moved) target.appendChild(child)
    removeNode(anchor)
    const seam = target.childNodes.length - moved.length
    placeCaret(editor, selection, target, seam >= 0 ? seam : target.childNodes.length)
    return true
  }

  const moved = Array.from(anchor.childNodes)
  const anchorIndex = Array.prototype.indexOf.call(anchorParent.childNodes, anchor)
  for (const child of moved) anchorParent.insertBefore(child, anchor)
  removeNode(anchor)
  placeCaret(editor, selection, anchorParent, anchorIndex)
  return true
}

function eatAheadUnit(editor: HTMLDivElement, selection: Selection): boolean {
  if (selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  const container = range.startContainer
  if (container.nodeType === Node.TEXT_NODE && (container.textContent ?? '').length > 0)
    return false

  const markers: Node[] = []
  let node: Node = container
  let first = true
  while (true) {
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
        return false
      }
      follower = follower.nextSibling
    }
    if (node === editor) return false
    first = false
    node = node.parentElement as Node
  }
}

function reportNow(editor: HTMLDivElement, onChange: BodyEditorProps['onChange']): void {
  editor.toggleAttribute('data-empty', isVisuallyEmpty(editor))
  onChange(readContent(editor))
}

function insertDataUrlAtCaret(editor: HTMLDivElement, dataUrl: string): void {
  const img = document.createElement('img')
  img.src = dataUrl
  const selection = window.getSelection()
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
  const after = document.createRange()
  after.setStartAfter(img)
  after.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(after)
}

async function insertImageFiles(editor: HTMLDivElement, files: File[]): Promise<File[]> {
  const leftovers: File[] = []
  for (const file of files) {
    const payload = await imageToPayload(file)
    if (payload) insertDataUrlAtCaret(editor, `data:${payload.mimeType};base64,${payload.base64}`)
    else leftovers.push(file)
  }
  return leftovers
}

const SIGNATURE_OWNED_SELECTOR = `:scope > ${SIGNATURE_BLOCK_SELECTOR}`

function removeSignatureBlocks(editor: HTMLDivElement): void {
  for (const existing of Array.from(editor.querySelectorAll(SIGNATURE_OWNED_SELECTOR))) {
    existing.remove()
  }
}

function insertSignatureBlockInto(editor: HTMLDivElement, html: string, focusCaret: boolean): void {
  removeSignatureBlocks(editor)
  const block = document.createElement('div')
  block.className = SIGNATURE_BLOCK_CLASS
  block.innerHTML = (isVisuallyEmpty(editor) ? '' : '<br>') + html
  editor.appendChild(block)
  if (!focusCaret) return
  const index = Array.prototype.indexOf.call(editor.childNodes, block)
  const selection = window.getSelection()
  if (selection) placeCaret(editor, selection, editor, Math.max(index, 0))
  else editor.focus()
}

export const BodyEditor = forwardRef<BodyEditorHandle, BodyEditorProps>(function BodyEditor(
  { initialHtml, placeholder, onChange, onNonImageFiles },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const onChangeRef = useLatest(onChange)
  const reportAfterEditTransaction = useAfterCurrentTask(() => {
    if (editorRef.current) reportNow(editorRef.current, onChangeRef.current)
  })

  useOnMount(() => {
    const editor = editorRef.current
    if (!editor) return
    if (initialHtml) editor.innerHTML = initialHtml
    reportNow(editor, onChange)
  })

  useImperativeHandle(
    ref,
    () => ({
      insertImages: async (files: File[]) => {
        const editor = editorRef.current
        if (!editor) return
        await insertImageFiles(editor, files)
        editor.focus()
        reportNow(editor, onChangeRef.current)
      },
      insertSignatureBlock: (html: string, options?: { focusCaret?: boolean }) => {
        const editor = editorRef.current
        if (!editor) return
        insertSignatureBlockInto(editor, html, options?.focusCaret ?? true)
        reportNow(editor, onChangeRef.current)
      },
      removeSignatureBlock: () => {
        const editor = editorRef.current
        if (!editor) return
        removeSignatureBlocks(editor)
        editor.focus()
        reportNow(editor, onChangeRef.current)
      },
      hasSignatureBlock: () => Boolean(editorRef.current?.querySelector(SIGNATURE_OWNED_SELECTOR))
    }),

    [onChangeRef]
  )

  async function handleDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    event.stopPropagation()
    const editor = event.currentTarget
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY)
      if (range) {
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      }
    }
    const files = Array.from(event.dataTransfer.files)
    const leftovers = await insertImageFiles(editor, files)
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
      onInput={reportAfterEditTransaction}
      onDrop={(event) => void handleDrop(event)}
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
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          document.execCommand('insertLineBreak')
          reportAfterEditTransaction()
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
          reportAfterEditTransaction()
        }
      }}
    />
  )
})
