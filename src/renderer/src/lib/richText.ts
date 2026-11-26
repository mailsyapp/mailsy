import { QUOTE_BLOCKQUOTE_STYLE, escapeHtml } from './emailHtml'

export type FormatCommand =
  'bold' | 'italic' | 'underline' | 'bulletList' | 'numberedList' | 'quote' | 'clear'

export interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  bulletList: boolean
  numberedList: boolean
  quote: boolean
  link: string | null
}

export interface LinkTarget {
  href: string
  text: string
}

export const EMPTY_FORMAT_STATE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  bulletList: false,
  numberedList: false,
  quote: false,
  link: null
}

export function sameFormatState(a: FormatState, b: FormatState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.bulletList === b.bulletList &&
    a.numberedList === b.numberedList &&
    a.quote === b.quote &&
    a.link === b.link
  )
}

export function selectionRangeIn(editor: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return editor.contains(range.commonAncestorContainer) ? range : null
}

function closestWithin(editor: HTMLElement, node: Node, selector: string): HTMLElement | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const found = start?.closest(selector)
  return found instanceof HTMLElement && found !== editor && editor.contains(found) ? found : null
}

export function insideListItem(editor: HTMLElement): boolean {
  const range = selectionRangeIn(editor)
  return range !== null && closestWithin(editor, range.startContainer, 'li') !== null
}

export function readFormatState(editor: HTMLElement): FormatState {
  const range = selectionRangeIn(editor)
  if (!range) return EMPTY_FORMAT_STATE
  const node = range.startContainer
  const list = closestWithin(editor, node, 'ul, ol')
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    bulletList: list?.tagName === 'UL',
    numberedList: list?.tagName === 'OL',
    quote: closestWithin(editor, node, 'blockquote') !== null,
    link: closestWithin(editor, node, 'a[href]')?.getAttribute('href') ?? null
  }
}

type Boundary = { node: Node; offset: number }

function paragraphEdge(range: Range, direction: 'backward' | 'forward'): Boundary | null {
  const selection = window.getSelection()
  if (!selection) return null
  const probe = range.cloneRange()
  probe.collapse(direction === 'backward')
  selection.removeAllRanges()
  selection.addRange(probe)
  selection.modify('move', direction, 'paragraphboundary')
  return selection.focusNode ? { node: selection.focusNode, offset: selection.focusOffset } : null
}

function trimSeparator(container: Node, edge: 'start' | 'end'): void {
  for (;;) {
    const node = edge === 'start' ? container.firstChild : container.lastChild
    if (!node) return
    if (node.nodeName === 'BR') {
      node.remove()
      return
    }
    if (node.nodeType !== Node.TEXT_NODE) return
    const text = node as Text
    if (text.data === '') {
      text.remove()
      continue
    }
    const pattern = edge === 'start' ? /^\n/ : /\n$/
    if (pattern.test(text.data)) {
      text.data = text.data.replace(pattern, '')
      if (text.data === '') text.remove()
    }
    return
  }
}

function blank(node: Node): boolean {
  return (
    (node.textContent ?? '').replace(/\n/g, '') === '' &&
    !(node instanceof Element || node instanceof DocumentFragment
      ? node.querySelector('img')
      : false)
  )
}

function unquoteParagraph(editor: HTMLElement, quote: HTMLElement, range: Range): void {
  const parent = quote.parentNode
  if (!parent) return
  const inside = (edge: Boundary | null): edge is Boundary =>
    edge !== null && quote.contains(edge.node)
  const start = paragraphEdge(range, 'backward')
  const end = paragraphEdge(range, 'forward')
  const middle = document.createRange()
  middle.selectNodeContents(quote)
  if (inside(start)) middle.setStart(start.node, start.offset)
  if (inside(end)) middle.setEnd(end.node, end.offset)
  const tail = document.createRange()
  tail.selectNodeContents(quote)
  tail.setStart(middle.endContainer, middle.endOffset)
  const tailContent = tail.extractContents()
  const line = middle.extractContents()
  trimSeparator(quote, 'end')
  trimSeparator(tailContent, 'start')
  trimSeparator(line, 'start')
  trimSeparator(line, 'end')
  const anchor = quote.nextSibling
  const placeholder = blank(line) ? document.createElement('br') : null
  const moved = placeholder ? [placeholder] : Array.from(line.childNodes)
  if (placeholder) parent.insertBefore(placeholder, anchor)
  else parent.insertBefore(line, anchor)
  if (!blank(tailContent)) {
    const rest = quote.cloneNode(false)
    rest.appendChild(tailContent)
    parent.insertBefore(rest, anchor)
  }
  if (blank(quote)) quote.remove()
  const caret = document.createRange()
  if (placeholder) {
    caret.setStartBefore(placeholder)
    caret.collapse(true)
  } else {
    caret.setStartBefore(moved[0])
    caret.setEndAfter(moved[moved.length - 1])
    if (range.collapsed) caret.collapse(false)
  }
  const selection = window.getSelection()
  selection?.removeAllRanges()
  if (editor.contains(caret.startContainer)) selection?.addRange(caret)
}

function toggleQuote(editor: HTMLElement): void {
  const range = selectionRangeIn(editor)
  if (!range) return
  const existing = closestWithin(editor, range.startContainer, 'blockquote')
  if (existing) {
    unquoteParagraph(editor, existing, range.cloneRange())
    return
  }
  const before = new Set(editor.querySelectorAll('blockquote'))
  document.execCommand('formatBlock', false, 'blockquote')
  for (const quote of Array.from(editor.querySelectorAll('blockquote'))) {
    if (before.has(quote)) continue
    quote.setAttribute('style', QUOTE_BLOCKQUOTE_STYLE)
  }
}

export function applyFormat(editor: HTMLElement, command: FormatCommand): void {
  switch (command) {
    case 'bold':
    case 'italic':
    case 'underline':
      document.execCommand(command)
      return
    case 'bulletList':
      document.execCommand('insertUnorderedList')
      return
    case 'numberedList':
      document.execCommand('insertOrderedList')
      return
    case 'quote':
      toggleQuote(editor)
      return
    case 'clear':
      document.execCommand('removeFormat')
      document.execCommand('unlink')
      return
  }
}

const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return null
  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    candidate = /^[^@/]+@[^@/]+\.[^@/]+$/.test(trimmed)
      ? `mailto:${trimmed}`
      : `https://${trimmed.replace(/^\/\//, '')}`
  }
  try {
    const url = new URL(candidate)
    if (!ALLOWED_LINK_SCHEMES.has(url.protocol)) return null
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.') && url.hostname !== 'localhost')
      return null
    return url.href
  } catch {
    return null
  }
}

function selectNode(node: Node): Range {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

export function linkTargetAt(editor: HTMLElement): LinkTarget {
  const range = selectionRangeIn(editor)
  if (!range) return { href: '', text: '' }
  const anchor = closestWithin(editor, range.commonAncestorContainer, 'a[href]')
  if (anchor) return { href: anchor.getAttribute('href') ?? '', text: anchor.textContent ?? '' }
  return { href: '', text: range.toString() }
}

export function applyLink(editor: HTMLElement, href: string, text: string): void {
  let range = selectionRangeIn(editor)
  if (!range) return
  const anchor = closestWithin(editor, range.commonAncestorContainer, 'a[href]')
  if (anchor) range = selectNode(anchor)
  const label = text.trim() === '' ? range.toString() || href : text
  if (!range.collapsed && label === range.toString()) {
    document.execCommand('createLink', false, href)
    return
  }
  document.execCommand(
    'insertHTML',
    false,
    `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
  )
}

export function removeLink(editor: HTMLElement): void {
  const range = selectionRangeIn(editor)
  if (!range) return
  const anchor = closestWithin(editor, range.commonAncestorContainer, 'a[href]')
  if (anchor) selectNode(anchor)
  document.execCommand('unlink')
}

export type FormatShortcut = FormatCommand | 'link'

export function formatShortcutOf(event: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): FormatShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  if (event.shiftKey) {
    if (event.code === 'Digit7') return 'numberedList'
    if (event.code === 'Digit8') return 'bulletList'
    if (event.code === 'Digit9') return 'quote'
    return null
  }
  switch (event.key.toLowerCase()) {
    case 'b':
      return 'bold'
    case 'i':
      return 'italic'
    case 'u':
      return 'underline'
    case 'k':
      return 'link'
    case '\\':
      return 'clear'
  }
  return null
}
