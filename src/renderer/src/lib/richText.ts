import { escapeHtml, QUOTE_BLOCKQUOTE_STYLE } from './emailHtml'

export type FormatCommand =
  'bold' | 'italic' | 'underline' | 'bulletedList' | 'numberedList' | 'quote' | 'clear'

export interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  link: boolean
  bulletedList: boolean
  numberedList: boolean
  quote: boolean
}

export const EMPTY_FORMAT_STATE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  link: false,
  bulletedList: false,
  numberedList: false,
  quote: false
}

export interface LinkSelection {
  text: string
  href: string
  editing: boolean
}

const REPLY_QUOTE_SELECTOR = '.gmail_quote_container'
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export function sameFormatState(a: FormatState, b: FormatState): boolean {
  return (Object.keys(a) as (keyof FormatState)[]).every((key) => a[key] === b[key])
}

export function normalizeLinkUrl(raw: string): string | null {
  const value = raw.trim()
  if (value === '' || /\s/.test(value)) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)
  const candidate = scheme
    ? value
    : /^[^@/]+@[^@/]+\.[^@/]+$/.test(value)
      ? `mailto:${value}`
      : `https://${value}`
  try {
    const url = new URL(candidate)
    if (!SAFE_LINK_SCHEMES.has(url.protocol)) return null
    if (url.protocol !== 'mailto:' && !url.hostname) return null
    return candidate
  } catch {
    return null
  }
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
}

function closestWithin(editor: HTMLElement, node: Node | null, selector: string): Element | null {
  const found = elementOf(node)?.closest(selector) ?? null
  return found && found !== editor && editor.contains(found) ? found : null
}

export function selectionRangeIn(editor: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return editor.contains(range.commonAncestorContainer) ? range : null
}

export function restoreRange(editor: HTMLElement, range: Range | null): void {
  editor.focus()
  if (!range || !editor.contains(range.commonAncestorContainer)) return
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

function userQuoteAt(editor: HTMLElement, node: Node | null): HTMLElement | null {
  let probe = closestWithin(editor, node, 'blockquote')
  while (probe) {
    if (!probe.closest(REPLY_QUOTE_SELECTOR)) return probe as HTMLElement
    probe = closestWithin(editor, probe.parentElement, 'blockquote')
  }
  return null
}

function linkAt(editor: HTMLElement, range: Range): HTMLAnchorElement | null {
  return (
    (closestWithin(editor, range.startContainer, 'a[href]') as HTMLAnchorElement | null) ??
    (closestWithin(editor, range.endContainer, 'a[href]') as HTMLAnchorElement | null)
  )
}

export function readFormatState(editor: HTMLElement): FormatState {
  const range = selectionRangeIn(editor)
  if (!range) return EMPTY_FORMAT_STATE
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    link: linkAt(editor, range) !== null,
    bulletedList:
      closestWithin(editor, range.startContainer, 'li')?.parentElement?.tagName === 'UL',
    numberedList:
      closestWithin(editor, range.startContainer, 'li')?.parentElement?.tagName === 'OL',
    quote: userQuoteAt(editor, range.startContainer) !== null
  }
}

function unwrap(element: Element): void {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

function toggleQuote(editor: HTMLElement): void {
  const range = selectionRangeIn(editor)
  const existing = userQuoteAt(editor, range?.startContainer ?? null)
  if (existing) {
    const selection = window.getSelection()
    const first = existing.firstChild
    const last = existing.lastChild
    unwrap(existing)
    if (selection && first && last) {
      const kept = document.createRange()
      kept.setStartBefore(first)
      kept.setEndAfter(last)
      selection.removeAllRanges()
      selection.addRange(kept)
    }
    return
  }
  document.execCommand('formatBlock', false, 'blockquote')
  const after = selectionRangeIn(editor)
  const created = closestWithin(editor, after?.startContainer ?? null, 'blockquote')
  if (created && !created.closest(REPLY_QUOTE_SELECTOR) && !created.getAttribute('style'))
    created.setAttribute('style', QUOTE_BLOCKQUOTE_STYLE)
}

export function applyFormat(editor: HTMLElement, command: FormatCommand): void {
  document.execCommand('styleWithCSS', false, 'false')
  switch (command) {
    case 'bold':
    case 'italic':
    case 'underline':
      document.execCommand(command)
      return
    case 'bulletedList':
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

export function readLinkSelection(editor: HTMLElement, range: Range | null): LinkSelection {
  if (!range || !editor.contains(range.commonAncestorContainer))
    return { text: '', href: '', editing: false }
  const anchor = linkAt(editor, range)
  if (anchor)
    return {
      text: anchor.textContent ?? '',
      href: anchor.getAttribute('href') ?? '',
      editing: true
    }
  return { text: range.toString(), href: '', editing: false }
}

export function applyLink(
  editor: HTMLElement,
  range: Range | null,
  href: string,
  text: string
): void {
  restoreRange(editor, range)
  const current = selectionRangeIn(editor)
  const label = text.trim() === '' ? href : text
  const anchor = current ? linkAt(editor, current) : null
  if (anchor) {
    anchor.setAttribute('href', href)
    if (anchor.textContent !== label) anchor.textContent = label
    const selection = window.getSelection()
    const after = document.createRange()
    after.setStartAfter(anchor)
    after.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(after)
    return
  }
  if (current && !current.collapsed && current.toString() === label) {
    document.execCommand('createLink', false, href)
    return
  }
  document.execCommand(
    'insertHTML',
    false,
    `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
  )
}

export function removeLink(editor: HTMLElement, range: Range | null): void {
  restoreRange(editor, range)
  const current = selectionRangeIn(editor)
  const anchor = current ? linkAt(editor, current) : null
  if (!anchor) return
  const selection = window.getSelection()
  const whole = document.createRange()
  whole.selectNodeContents(anchor)
  selection?.removeAllRanges()
  selection?.addRange(whole)
  document.execCommand('unlink')
}

export function isInListItem(editor: HTMLElement): boolean {
  const range = selectionRangeIn(editor)
  return range !== null && closestWithin(editor, range.startContainer, 'li') !== null
}

export function formatShortcut(event: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): FormatCommand | 'link' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  if (!event.shiftKey) {
    const key = event.key.toLowerCase()
    if (key === 'b') return 'bold'
    if (key === 'i') return 'italic'
    if (key === 'u') return 'underline'
    if (key === 'k') return 'link'
    if (event.code === 'Backslash') return 'clear'
    return null
  }
  if (event.code === 'Digit7') return 'numberedList'
  if (event.code === 'Digit8') return 'bulletedList'
  if (event.code === 'Digit9') return 'quote'
  return null
}
