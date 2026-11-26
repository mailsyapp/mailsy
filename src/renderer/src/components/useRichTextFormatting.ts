import { useState } from 'react'
import type { BodyEditorHandle } from './BodyEditor'
import {
  EMPTY_FORMAT_STATE,
  normalizeLinkUrl,
  sameFormatState,
  type FormatCommand,
  type FormatState
} from '../lib/richText'

export interface LinkDraft {
  href: string
  text: string
  editing: boolean
  error: string | null
}

export interface RichTextFormatting {
  state: FormatState
  refresh: () => void
  apply: (command: FormatCommand) => void
  link: LinkDraft | null
  openLink: () => void
  changeLink: (patch: Partial<Pick<LinkDraft, 'href' | 'text'>>) => void
  submitLink: () => void
  removeLink: () => void
  closeLink: () => void
}

export const INVALID_LINK_ERROR = 'Enter a web address (https://...) or an email address.'

export function useRichTextFormatting(
  editor: React.RefObject<BodyEditorHandle | null>
): RichTextFormatting {
  const [state, setState] = useState<FormatState>(EMPTY_FORMAT_STATE)
  const [link, setLink] = useState<LinkDraft | null>(null)
  function refresh(): void {
    const next = editor.current?.formatState() ?? EMPTY_FORMAT_STATE
    setState((prev) => (sameFormatState(prev, next) ? prev : next))
  }
  return {
    state,
    refresh,
    apply: (command) => {
      editor.current?.format(command)
      refresh()
    },
    link,
    openLink: () => {
      const target = editor.current?.linkTarget() ?? { href: '', text: '' }
      setLink({ ...target, editing: target.href !== '', error: null })
    },
    changeLink: (patch) => setLink((prev) => (prev ? { ...prev, ...patch, error: null } : prev)),
    submitLink: () => {
      if (!link) return
      const href = normalizeLinkUrl(link.href)
      if (!href) {
        setLink({ ...link, error: INVALID_LINK_ERROR })
        return
      }
      editor.current?.applyLink(href, link.text)
      setLink(null)
      refresh()
    },
    removeLink: () => {
      editor.current?.removeLink()
      setLink(null)
      refresh()
    },
    closeLink: () => {
      setLink(null)
      refresh()
    }
  }
}
