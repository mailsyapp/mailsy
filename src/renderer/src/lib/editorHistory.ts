interface Snapshot {
  html: string
  start: number[] | null
  startOffset: number
  end: number[] | null
  endOffset: number
}

const HISTORY_LIMIT = 200
const HISTORY_CHAR_LIMIT = 64 * 1024 * 1024
const COALESCE_MS = 1000

export function pathTo(root: Node, node: Node): number[] | null {
  const path: number[] = []
  let probe = node
  while (probe !== root) {
    const parent = probe.parentNode
    if (!parent) return null
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, probe))
    probe = parent
  }
  return path
}

export function nodeAt(root: Node, path: number[] | null): Node | null {
  if (!path) return null
  let probe: Node | null = root
  for (const index of path) probe = probe?.childNodes[index] ?? null
  return probe
}

function nodeLength(node: Node): number {
  return node.nodeType === Node.ELEMENT_NODE
    ? node.childNodes.length
    : (node.textContent ?? '').length
}

function capture(editor: HTMLElement, fallback: Range | null = null): Snapshot {
  const selection = window.getSelection()
  const live = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const range = live && editor.contains(live.commonAncestorContainer) ? live : fallback
  const inside = range && editor.contains(range.commonAncestorContainer)
  return {
    html: editor.innerHTML,
    start: inside ? pathTo(editor, range.startContainer) : null,
    startOffset: inside ? range.startOffset : 0,
    end: inside ? pathTo(editor, range.endContainer) : null,
    endOffset: inside ? range.endOffset : 0
  }
}

function restore(editor: HTMLElement, snapshot: Snapshot): void {
  editor.innerHTML = snapshot.html
  const start = nodeAt(editor, snapshot.start)
  const end = nodeAt(editor, snapshot.end)
  const selection = window.getSelection()
  if (!selection) return
  editor.focus()
  const range = document.createRange()
  if (start && end) {
    range.setStart(start, Math.min(snapshot.startOffset, nodeLength(start)))
    range.setEnd(end, Math.min(snapshot.endOffset, nodeLength(end)))
  } else {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

export class EditorHistory {
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  private lastKind: string | null = null
  private lastAt = 0

  reset(): void {
    this.undoStack = []
    this.redoStack = []
    this.lastKind = null
  }

  seal(): void {
    this.lastKind = null
  }

  record(editor: HTMLElement, kind: string | null = null, fallback: Range | null = null): void {
    const now = Date.now()
    const coalesce = kind !== null && kind === this.lastKind && now - this.lastAt < COALESCE_MS
    this.lastKind = kind
    this.lastAt = now
    if (coalesce) return
    const snapshot = capture(editor, fallback)
    if (this.undoStack.at(-1)?.html === snapshot.html && this.redoStack.length === 0) return
    this.push(snapshot)
  }

  change(editor: HTMLElement, apply: () => void): void {
    const snapshot = capture(editor)
    apply()
    this.lastKind = null
    if (editor.innerHTML === snapshot.html) return
    this.push(snapshot)
  }

  private push(snapshot: Snapshot): void {
    this.undoStack.push(snapshot)
    this.redoStack = []
    let chars = this.undoStack.reduce((total, entry) => total + entry.html.length, 0)
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > HISTORY_LIMIT || chars > HISTORY_CHAR_LIMIT)
    ) {
      chars -= this.undoStack.shift()?.html.length ?? 0
    }
  }

  undo(editor: HTMLElement): boolean {
    return this.step(editor, this.undoStack, this.redoStack)
  }

  redo(editor: HTMLElement): boolean {
    return this.step(editor, this.redoStack, this.undoStack)
  }

  private step(editor: HTMLElement, from: Snapshot[], to: Snapshot[]): boolean {
    const target = from.pop()
    if (!target) return false
    to.push(capture(editor))
    restore(editor, target)
    this.lastKind = null
    return true
  }
}
