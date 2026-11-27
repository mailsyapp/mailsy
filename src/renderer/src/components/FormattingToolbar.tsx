import { useId, useState } from 'react'
import {
  Bold,
  Italic,
  Link,
  List,
  ListOrdered,
  RemoveFormatting,
  TextQuote,
  Underline,
  type LucideIcon
} from 'lucide-react'
import { normalizeLinkUrl, type FormatCommand, type FormatState } from '../lib/richText'
import type { BodyEditorHandle } from './BodyEditor'

export interface LinkEditorState {
  text: string
  href: string
  editing: boolean
}

type FormattingToolbarProps = {
  editor: React.RefObject<BodyEditorHandle | null>
  state: FormatState
  link: LinkEditorState | null
  onOpenLink: () => void
  onCloseLink: () => void
}

type ToolbarButton = {
  command: FormatCommand
  label: string
  shortcut: string
  icon: LucideIcon
  pressed?: keyof FormatState
}

const INLINE_BUTTONS: ToolbarButton[] = [
  { command: 'bold', label: 'Bold', shortcut: 'Ctrl+B', icon: Bold, pressed: 'bold' },
  { command: 'italic', label: 'Italic', shortcut: 'Ctrl+I', icon: Italic, pressed: 'italic' },
  {
    command: 'underline',
    label: 'Underline',
    shortcut: 'Ctrl+U',
    icon: Underline,
    pressed: 'underline'
  }
]

const BLOCK_BUTTONS: ToolbarButton[] = [
  {
    command: 'numberedList',
    label: 'Numbered list',
    shortcut: 'Ctrl+Shift+7',
    icon: ListOrdered,
    pressed: 'numberedList'
  },
  {
    command: 'bulletedList',
    label: 'Bulleted list',
    shortcut: 'Ctrl+Shift+8',
    icon: List,
    pressed: 'bulletedList'
  },
  { command: 'quote', label: 'Quote', shortcut: 'Ctrl+Shift+9', icon: TextQuote, pressed: 'quote' },
  {
    command: 'clear',
    label: 'Remove formatting',
    shortcut: 'Ctrl+\\',
    icon: RemoveFormatting
  }
]

function keepEditorSelection(event: React.MouseEvent): void {
  event.preventDefault()
}

function LinkEditor({
  editor,
  link,
  onClose
}: {
  editor: React.RefObject<BodyEditorHandle | null>
  link: LinkEditorState
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState(link.text)
  const [href, setHref] = useState(link.href)
  const [error, setError] = useState<string | null>(null)
  const textId = useId()
  const hrefId = useId()

  function apply(): void {
    const url = normalizeLinkUrl(href)
    if (!url) {
      setError('Enter a valid web address or email.')
      return
    }
    editor.current?.applyLink(url, text)
    onClose()
  }

  function remove(): void {
    editor.current?.removeLink()
    onClose()
  }

  return (
    <div
      className="linkEdit"
      role="group"
      aria-label="Edit link"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          apply()
        }
      }}
    >
      <label htmlFor={textId}>Text to display</label>
      <input id={textId} value={text} onChange={(event) => setText(event.target.value)} />
      <label htmlFor={hrefId}>Web address</label>
      <input
        id={hrefId}
        value={href}
        autoFocus
        placeholder="https://example.com or name@example.com"
        onChange={(event) => {
          setError(null)
          setHref(event.target.value)
        }}
      />
      {error && (
        <p role="alert" className="linkEdit-error">
          {error}
        </p>
      )}
      <div className="linkEdit-actions">
        {link.editing && (
          <button type="button" onClick={remove}>
            Remove link
          </button>
        )}
        <button type="button" onClick={onClose}>
          Cancel link
        </button>
        <button type="button" onClick={apply}>
          Apply link
        </button>
      </div>
    </div>
  )
}

export function FormattingToolbar({
  editor,
  state,
  link,
  onOpenLink,
  onCloseLink
}: FormattingToolbarProps): React.JSX.Element {
  const renderButton = ({
    command,
    label,
    shortcut,
    icon: Icon,
    pressed
  }: ToolbarButton): React.JSX.Element => (
    <button
      key={command}
      type="button"
      aria-label={label}
      title={`${label} (${shortcut})`}
      {...(pressed ? { 'aria-pressed': state[pressed] } : {})}
      onMouseDown={keepEditorSelection}
      onClick={() => editor.current?.format(command)}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  )
  return (
    <div className="formattingBar">
      <div className="formattingToolbar" role="toolbar" aria-label="Formatting options">
        {INLINE_BUTTONS.map(renderButton)}
        <button
          type="button"
          aria-label="Link"
          title="Link (Ctrl+K)"
          aria-pressed={state.link}
          aria-expanded={link !== null}
          onMouseDown={keepEditorSelection}
          onClick={onOpenLink}
        >
          <Link size={16} aria-hidden="true" />
        </button>
        {BLOCK_BUTTONS.map(renderButton)}
      </div>
      {link && <LinkEditor editor={editor} link={link} onClose={onCloseLink} />}
    </div>
  )
}
