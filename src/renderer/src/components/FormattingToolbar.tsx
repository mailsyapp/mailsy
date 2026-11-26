import { useId } from 'react'
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
import type { FormatCommand, FormatState } from '../lib/richText'
import type { RichTextFormatting } from './useRichTextFormatting'

type ToolbarButton = {
  command: FormatCommand
  label: string
  shortcut: string
  icon: LucideIcon
  pressed?: keyof Omit<FormatState, 'link'>
}

const BUTTONS: ToolbarButton[] = [
  { command: 'bold', label: 'Bold', shortcut: 'Ctrl+B', icon: Bold, pressed: 'bold' },
  { command: 'italic', label: 'Italic', shortcut: 'Ctrl+I', icon: Italic, pressed: 'italic' },
  {
    command: 'underline',
    label: 'Underline',
    shortcut: 'Ctrl+U',
    icon: Underline,
    pressed: 'underline'
  },
  {
    command: 'numberedList',
    label: 'Numbered list',
    shortcut: 'Ctrl+Shift+7',
    icon: ListOrdered,
    pressed: 'numberedList'
  },
  {
    command: 'bulletList',
    label: 'Bulleted list',
    shortcut: 'Ctrl+Shift+8',
    icon: List,
    pressed: 'bulletList'
  },
  { command: 'quote', label: 'Quote', shortcut: 'Ctrl+Shift+9', icon: TextQuote, pressed: 'quote' },
  { command: 'clear', label: 'Remove formatting', shortcut: 'Ctrl+\\', icon: RemoveFormatting }
]

function keepEditorSelection(event: React.MouseEvent): void {
  event.preventDefault()
}

function onLinkFieldKey(event: React.KeyboardEvent, formatting: RichTextFormatting): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    formatting.submitLink()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    formatting.closeLink()
  }
}

export function FormattingToolbar({
  formatting
}: {
  formatting: RichTextFormatting
}): React.JSX.Element {
  const textId = useId()
  const hrefId = useId()
  const { state, link } = formatting
  const button = (spec: ToolbarButton): React.JSX.Element => {
    const Icon = spec.icon
    return (
      <button
        key={spec.command}
        type="button"
        className="formatButton"
        aria-label={spec.label}
        title={`${spec.label} (${spec.shortcut})`}
        aria-pressed={spec.pressed ? state[spec.pressed] : undefined}
        onMouseDown={keepEditorSelection}
        onClick={() => formatting.apply(spec.command)}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    )
  }
  return (
    <div className="formatBar">
      <div role="toolbar" aria-label="Formatting options" className="formatBar-buttons">
        {BUTTONS.slice(0, 3).map(button)}
        <button
          type="button"
          className="formatButton"
          aria-label="Insert link"
          title="Insert link (Ctrl+K)"
          aria-pressed={state.link !== null}
          onMouseDown={keepEditorSelection}
          onClick={formatting.openLink}
        >
          <Link size={16} aria-hidden="true" />
        </button>
        {BUTTONS.slice(3).map(button)}
      </div>
      {link && (
        <div className="linkEdit" role="group" aria-label="Edit link">
          <label htmlFor={textId}>Text to display</label>
          <input
            id={textId}
            value={link.text}
            onChange={(event) => formatting.changeLink({ text: event.target.value })}
            onKeyDown={(event) => onLinkFieldKey(event, formatting)}
          />
          <label htmlFor={hrefId}>Link to</label>
          <input
            id={hrefId}
            value={link.href}
            placeholder="https://example.com or name@example.com"
            autoFocus
            aria-invalid={link.error !== null}
            onChange={(event) => formatting.changeLink({ href: event.target.value })}
            onKeyDown={(event) => onLinkFieldKey(event, formatting)}
          />
          {link.error && (
            <p role="alert" className="linkEdit-error">
              {link.error}
            </p>
          )}
          <div className="linkEdit-actions">
            {link.editing && (
              <button type="button" onClick={formatting.removeLink}>
                Remove link
              </button>
            )}
            <button type="button" onClick={formatting.closeLink}>
              Cancel link
            </button>
            <button type="button" onClick={formatting.submitLink}>
              Apply link
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
