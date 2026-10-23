import { HugeiconsIcon } from '@hugeicons/react'
import {
  Clock01Icon,
  Delete02Icon,
  InboxIcon,
  Mail01Icon,
  MailEdit01Icon,
  SentIcon,
  SpamIcon,
  StarIcon
} from '@hugeicons/core-free-icons'
import type { MailFolder } from '../../../shared/types'

const FOLDERS: Array<{ id: MailFolder; label: string; icon: typeof InboxIcon }> = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'starred', label: 'Starred', icon: StarIcon },
  { id: 'snoozed', label: 'Snoozed', icon: Clock01Icon },
  { id: 'drafts', label: 'Drafts', icon: MailEdit01Icon },
  { id: 'sent', label: 'Sent', icon: SentIcon },
  { id: 'spam', label: 'Spam', icon: SpamIcon },
  { id: 'trash', label: 'Trash', icon: Delete02Icon },
  { id: 'all', label: 'All Mail', icon: Mail01Icon }
]

interface FolderRailProps {
  activeFolder: MailFolder
  onSelect: (folder: MailFolder) => void
}

export function FolderRail({ activeFolder, onSelect }: FolderRailProps): React.JSX.Element {
  return (
    <nav className="folder-rail" aria-label="Mail folders">
      {FOLDERS.map((folder) => {
        const isActive = folder.id === activeFolder
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
    </nav>
  )
}
