import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AddIcon,
  Bookmark01Icon,
  Cancel01Icon,
  Clock01Icon,
  Delete02Icon,
  InboxIcon,
  InformationSquareIcon,
  Mail01Icon,
  MailEdit01Icon,
  MessageMultiple02Icon,
  SaleTag01Icon,
  SentIcon,
  SpamIcon,
  StarIcon,
  UserMultiple02Icon
} from '@hugeicons/core-free-icons'
import type { MailFolder, MailLabel } from '../../../shared/types'

const FOLDERS: Array<{ id: MailFolder; label: string; icon: typeof InboxIcon }> = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'starred', label: 'Starred', icon: StarIcon },
  { id: 'snoozed', label: 'Snoozed', icon: Clock01Icon },
  // Gmail's category stack, Important first, the four inbox tabs after it.
  { id: 'important', label: 'Important', icon: Bookmark01Icon },
  { id: 'social', label: 'Social', icon: UserMultiple02Icon },
  { id: 'promotions', label: 'Promotions', icon: SaleTag01Icon },
  { id: 'updates', label: 'Updates', icon: InformationSquareIcon },
  { id: 'forums', label: 'Forums', icon: MessageMultiple02Icon },
  { id: 'drafts', label: 'Drafts', icon: MailEdit01Icon },
  { id: 'sent', label: 'Sent', icon: SentIcon },
  { id: 'spam', label: 'Spam', icon: SpamIcon },
  { id: 'trash', label: 'Trash', icon: Delete02Icon },
  { id: 'all', label: 'All Mail', icon: Mail01Icon }
]

// One chip per user label, held together by the count it opens: the body
// carries the label's Gmail background color and text color, the count the
// thread total, and the corner holds the delete affordance. Selecting and
// deleting must be separate elements because a click target that is also a
// nested button is not renderable.
function UserLabelChip({
  label,
  isActive,
  onSelect,
  onDelete
}: {
  label: MailLabel
  isActive: boolean
  onSelect: (label: MailLabel) => void
  onDelete: (label: MailLabel) => void
}): React.JSX.Element {
  const color = label.color ?? { background: '#d9d9d9', text: '#000000' }
  return (
    <div className={`user-label-chip${isActive ? ' active' : ''}`}>
      <button
        type="button"
        className="user-label-chip-open"
        title={label.name}
        aria-label={label.name}
        aria-current={isActive ? 'page' : undefined}
        style={{ background: color.background, color: color.text }}
        onClick={() => onSelect(label)}
      >
        {label.threadsTotal > 0 ? label.threadsTotal : ''}
      </button>
      <button
        type="button"
        className="user-label-chip-remove"
        title={`Delete label ${label.name}`}
        aria-label={`Delete ${label.name}`}
        onClick={() => onDelete(label)}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
      </button>
    </div>
  )
}

interface FolderRailProps {
  activeFolder: MailFolder
  activeLabelId: string | null
  // The user labels to browse: system labels are filtered where the list
  // is loaded (App), so the rail renders exactly what the rail owns.
  labels: MailLabel[]
  onSelect: (folder: MailFolder) => void
  onSelectLabel: (label: MailLabel) => void
  onCreateLabel: (name: string) => void
  onDeleteLabel: (label: MailLabel) => void
}

export function FolderRail({
  activeFolder,
  activeLabelId,
  labels,
  onSelect,
  onSelectLabel,
  onCreateLabel,
  onDeleteLabel
}: FolderRailProps): React.JSX.Element {
  // The name entry is an inline rail input, not window.prompt: Electron
  // does not support prompt() and throws on it, while the 56px rail is
  // wide enough for one line of text. The draft closes on commit and on
  // Escape; blur never closes it so a stray click cannot eat the name.
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const draftRef = useRef<HTMLInputElement | null>(null)

  function commitDraft(): void {
    const name = draftName.trim()
    if (!name) return
    onCreateLabel(name)
    setDraftName('')
    setDraftOpen(false)
  }

  return (
    <nav className="folder-rail" aria-label="Mail folders">
      {FOLDERS.map((folder) => {
        const isActive = folder.id === activeFolder && activeLabelId === null
        return (
          <button
            key={folder.id}
            type="button"
            className={`folder-rail-button${isActive ? ' active' : ''}`}
            title={folder.label}
            aria-label={folder.label}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(folder.id)}
          >
            <HugeiconsIcon icon={folder.icon} size={22} strokeWidth={1.8} />
          </button>
        )
      })}
      {labels.length > 0 && (
        <div className="user-label-chips" aria-label="User labels">
          {labels.map((label) => (
            <UserLabelChip
              key={label.id}
              label={label}
              isActive={label.id === activeLabelId}
              onSelect={onSelectLabel}
              onDelete={onDeleteLabel}
            />
          ))}
        </div>
      )}
      {draftOpen && (
        <form
          className="user-label-create-form"
          onSubmit={(e) => {
            e.preventDefault()
            commitDraft()
          }}
        >
          <input
            ref={draftRef}
            className="user-label-create-input"
            aria-label="Label name"
            placeholder="New label"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraftName('')
                setDraftOpen(false)
              }
            }}
          />
        </form>
      )}
      <button
        type="button"
        className="user-label-create"
        aria-label="New label"
        title="New label"
        onClick={() => {
          setDraftOpen(true)
          // autofocus fires on mount, but an already-visited draft may
          // not re-run it; focus explicitly too.
          requestAnimationFrame(() => draftRef.current?.focus())
        }}
      >
        <HugeiconsIcon icon={AddIcon} size={18} strokeWidth={2.2} />
      </button>
    </nav>
  )
}
