import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { useAfterCurrentTask } from '../hooks/useAfterCurrentTask'
import { useLatest } from '../hooks/useLatest'
import { useOnMount } from '../hooks/useOnMount'
import { useSubscription } from '../hooks/useSubscription'
import { imageToPayload, looksLikeImageFile } from '../lib/attachmentFile'
import { EditorHistory } from '../lib/editorHistory'
import { SIGNATURE_BLOCK_CLASS, SIGNATURE_BLOCK_SELECTOR } from '../lib/signature'
import {
  applyFormat,
  applyLink,
  formatShortcut,
  isInListItem,
  readFormatState,
  readLinkSelection,
  removeLink,
  restoreRange,
  selectionRangeIn,
  serializeBodyHtml,
  type FormatCommand,
  type FormatState,
  type LinkSelection
} from '../lib/richText'
export interface BodyEditorHandle {
  insertImages: (files: File[]) => Promise<void>
  insertSignatureBlock: (
    html: string,
    options?: {
      focusCaret?: boolean
    }
  ) => void
  removeSignatureBlock: () => void
  hasSignatureBlock: () => boolean
  format: (command: FormatCommand) => void
  captureLinkSelection: () => LinkSelection
  applyLink: (href: string, text: string) => void
  removeLink: () => void
  cancelLink: () => void
}
type BodyEditorProps = {
  initialHtml: string
  placeholder?: string
  onChange: (content: { html: string; text: string }, source: 'edit' | 'prefill') => void
  onNonImageFiles: (files: File[]) => void
  onFormatState?: (state: FormatState) => void
  onRequestLink?: () => void
}
function readContent(editor: HTMLDivElement): {
  html: string
  text: string
} {
  const html = serializeBodyHtml(editor)
  const text = editor.innerText
  return { html: /^(\s|<br\/?>)*$/i.test(html) ? '' : html, text }
}
function isVisuallyEmpty(editor: HTMLElement): boolean {
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') continue
    if (node.nodeName === 'BR') continue
    if ((node.nodeName === 'DIV' || node.nodeName === 'P') && isVisuallyEmpty(node as HTMLElement))
      continue
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
  onChange(readContent(editor), 'edit')
}

type FormatStateListener = ((state: FormatState) => void) | undefined

function reportFormatState(editor: HTMLDivElement, onFormatState: FormatStateListener): void {
  onFormatState?.(readFormatState(editor))
}

function runFormat(
  editor: HTMLDivElement,
  command: FormatCommand,
  savedRange: Range | null,
  history: EditorHistory,
  onChange: BodyEditorProps['onChange'],
  onFormatState: FormatStateListener
): void {
  if (!selectionRangeIn(editor)) restoreRange(editor, savedRange)
  history.record(editor)
  applyFormat(editor, command)
  reportNow(editor, onChange)
  reportFormatState(editor, onFormatState)
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
  if (isVisuallyEmpty(editor)) editor.replaceChildren()
}
function signatureBodyParagraph(editor: HTMLDivElement): HTMLElement {
  const quoteSelector = 'blockquote, .gmail_quote, .gmail_quote_container'
  const excluded = `${quoteSelector}, ${SIGNATURE_BLOCK_SELECTOR}`
  const quote =
    Array.from(editor.children).find(
      (child) => child.matches(quoteSelector) || child.querySelector(quoteSelector)
    ) ?? null
  let preceding = quote ? quote.previousSibling : editor.lastChild
  const inlineRun: Node[] = []
  while (
    preceding &&
    (preceding.nodeType === Node.TEXT_NODE ||
      (preceding instanceof HTMLElement &&
        !preceding.matches(excluded) &&
        !preceding.querySelector(excluded) &&
        !isBlockElement(preceding)))
  ) {
    inlineRun.unshift(preceding)
    preceding = preceding.previousSibling
  }
  if (inlineRun.length > 0) {
    const paragraph = document.createElement('div')
    editor.insertBefore(paragraph, inlineRun[0])
    paragraph.append(...inlineRun)
    return paragraph
  }
  if (
    preceding instanceof HTMLElement &&
    (preceding.tagName === 'DIV' || preceding.tagName === 'P') &&
    !preceding.matches(excluded) &&
    !preceding.querySelector(excluded)
  )
    return preceding
  const paragraph = document.createElement('div')
  paragraph.appendChild(document.createElement('br'))
  editor.insertBefore(paragraph, quote)
  return paragraph
}
function insertSignatureBlockInto(editor: HTMLDivElement, html: string, focusCaret: boolean): void {
  removeSignatureBlocks(editor)
  const block = document.createElement('div')
  block.className = SIGNATURE_BLOCK_CLASS
  block.innerHTML = (isVisuallyEmpty(editor) ? '' : '<br>') + html
  const paragraph = signatureBodyParagraph(editor)
  editor.appendChild(block)
  if (!focusCaret) return
  const selection = window.getSelection()
  if (!selection) {
    editor.focus()
    return
  }
  let container = paragraph
  let offset = container.childNodes.length
  while (true) {
    while (
      offset > 0 &&
      container.childNodes[offset - 1].nodeType === Node.TEXT_NODE &&
      container.childNodes[offset - 1].textContent === ''
    )
      offset--
    const last = container.childNodes[offset - 1]
    if (
      !(last instanceof HTMLElement) ||
      last.tagName === 'BR' ||
      last.tagName === 'IMG' ||
      isBlockElement(last)
    )
      break
    container = last
    offset = container.childNodes.length
  }
  const last = container.childNodes[offset - 1]
  if (last?.nodeName === 'BR') {
    if (offset > 1 && last.previousSibling?.nodeName !== 'BR')
      container.insertBefore(document.createElement('br'), container.childNodes[offset] ?? null)
    else offset--
  }
  placeCaret(editor, selection, container, offset)
}
type HistoryDirection = 'undo' | 'redo'

function historyShortcut(event: React.KeyboardEvent): HistoryDirection | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && event.ctrlKey && !event.shiftKey) return 'redo'
  return null
}

const CARET_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

const COALESCED_INPUTS: Record<string, string> = {
  insertText: 'type',
  insertCompositionText: 'type',
  deleteContentBackward: 'delete',
  deleteContentForward: 'delete',
  deleteWordBackward: 'delete',
  deleteWordForward: 'delete'
}

export const BodyEditor = forwardRef<BodyEditorHandle, BodyEditorProps>(function BodyEditor(
  { initialHtml, placeholder, onChange, onNonImageFiles, onFormatState, onRequestLink },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const onChangeRef = useLatest(onChange)
  const onFormatStateRef = useLatest(onFormatState)
  const savedRangeRef = useRef<Range | null>(null)
  const linkRangeRef = useRef<Range | null>(null)
  const [history] = useState(() => new EditorHistory())
  const stepHistory = (editor: HTMLDivElement, direction: HistoryDirection): void => {
    if (!history[direction](editor)) return
    reportNow(editor, onChangeRef.current)
    reportFormatState(editor, onFormatStateRef.current)
  }
  useSubscription(true, () => {
    const editor = editorRef.current
    if (!editor) return () => {}
    const beforeInput = (event: InputEvent): void => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault()
        stepHistory(editor, event.inputType === 'historyUndo' ? 'undo' : 'redo')
        return
      }
      history.record(editor, COALESCED_INPUTS[event.inputType] ?? null)
    }
    editor.addEventListener('beforeinput', beforeInput)
    return () => editor.removeEventListener('beforeinput', beforeInput)
  })
  useSubscription(true, () => {
    const track = (): void => {
      const editor = editorRef.current
      if (!editor) return
      const range = selectionRangeIn(editor)
      if (!range) return
      savedRangeRef.current = range.cloneRange()
      reportFormatState(editor, onFormatStateRef.current)
    }
    document.addEventListener('selectionchange', track)
    return () => document.removeEventListener('selectionchange', track)
  })
  const reportAfterEditTransaction = useAfterCurrentTask(() => {
    if (editorRef.current) reportNow(editorRef.current, onChangeRef.current)
  })
  useOnMount(() => {
    const editor = editorRef.current
    if (!editor) return
    if (initialHtml) editor.innerHTML = initialHtml
    history.reset()
    editor.toggleAttribute('data-empty', isVisuallyEmpty(editor))
    onChange(readContent(editor), 'prefill')
  })
  useImperativeHandle(
    ref,
    () => ({
      insertImages: async (files: File[]) => {
        const editor = editorRef.current
        if (!editor) return
        history.record(editor)
        await insertImageFiles(editor, files)
        editor.focus()
        reportNow(editor, onChangeRef.current)
      },
      insertSignatureBlock: (
        html: string,
        options?: {
          focusCaret?: boolean
        }
      ) => {
        const editor = editorRef.current
        if (!editor) return
        history.record(editor)
        insertSignatureBlockInto(editor, html, options?.focusCaret ?? true)
        reportNow(editor, onChangeRef.current)
      },
      removeSignatureBlock: () => {
        const editor = editorRef.current
        if (!editor) return
        history.record(editor)
        removeSignatureBlocks(editor)
        editor.focus()
        reportNow(editor, onChangeRef.current)
      },
      hasSignatureBlock: () => Boolean(editorRef.current?.querySelector(SIGNATURE_OWNED_SELECTOR)),
      format: (command: FormatCommand) => {
        const editor = editorRef.current
        if (editor)
          runFormat(
            editor,
            command,
            savedRangeRef.current,
            history,
            onChangeRef.current,
            onFormatStateRef.current
          )
      },
      captureLinkSelection: () => {
        const editor = editorRef.current
        if (!editor) return { text: '', href: '', editing: false }
        const range = selectionRangeIn(editor) ?? savedRangeRef.current
        linkRangeRef.current = range ? range.cloneRange() : null
        return readLinkSelection(editor, linkRangeRef.current)
      },
      applyLink: (href: string, text: string) => {
        const editor = editorRef.current
        if (!editor) return
        history.record(editor, null, linkRangeRef.current)
        applyLink(editor, linkRangeRef.current, href, text)
        linkRangeRef.current = null
        reportNow(editor, onChangeRef.current)
        reportFormatState(editor, onFormatStateRef.current)
      },
      removeLink: () => {
        const editor = editorRef.current
        if (!editor) return
        history.record(editor, null, linkRangeRef.current)
        removeLink(editor, linkRangeRef.current)
        linkRangeRef.current = null
        reportNow(editor, onChangeRef.current)
        reportFormatState(editor, onFormatStateRef.current)
      },
      cancelLink: () => {
        const editor = editorRef.current
        if (!editor) return
        restoreRange(editor, linkRangeRef.current)
        linkRangeRef.current = null
      }
    }),
    [history, onChangeRef, onFormatStateRef]
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
    history.record(editor)
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
      onMouseDown={() => history.seal()}
      onDrop={(event) => void handleDrop(event)}
      onPaste={(event) => {
        const editor = event.currentTarget
        const files = Array.from(event.clipboardData.files).filter(looksLikeImageFile)
        if (files.length === 0) return
        event.preventDefault()
        history.record(editor)
        void insertImageFiles(editor, files).then(() => {
          editor.focus()
          reportNow(editor, onChangeRef.current)
        })
      }}
      onKeyDown={(event) => {
        if (CARET_KEYS.has(event.key)) history.seal()
        const direction = event.nativeEvent.isComposing ? null : historyShortcut(event)
        if (direction) {
          event.preventDefault()
          stepHistory(event.currentTarget, direction)
          return
        }
        const shortcut = event.nativeEvent.isComposing ? null : formatShortcut(event)
        if (shortcut) {
          event.preventDefault()
          if (shortcut === 'link') onRequestLink?.()
          else
            runFormat(
              event.currentTarget,
              shortcut,
              savedRangeRef.current,
              history,
              onChangeRef.current,
              onFormatStateRef.current
            )
          return
        }
        if (event.key === 'Enter' && !event.shiftKey && isInListItem(event.currentTarget)) {
          reportAfterEditTransaction()
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          history.record(event.currentTarget)
          document.execCommand('insertLineBreak')
          reportAfterEditTransaction()
          return
        }
        if (
          event.key === 'Backspace' &&
          !event.nativeEvent.isComposing &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          history.record(event.currentTarget, 'delete')
          if (mergeBackward(event.currentTarget)) {
            event.preventDefault()
            reportAfterEditTransaction()
          }
        }
      }}
    />
  )
})
