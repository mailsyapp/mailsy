import { HugeiconsIcon } from '@hugeicons/react'
import { StarIcon } from '@hugeicons/core-free-icons'
import type { MailFolder, ThreadSummary } from '../../../shared/types'
import { senderNameOf } from '../lib/format'

// One list row: the opener (subject, participants, snippet) plus the
// folder's inline action buttons. The action handlers stay App-side,
// where the list truth they mutate lives.
type MailListRowProps = {
  row: ThreadSummary
  folder: MailFolder
  onOpen: (row: ThreadSummary) => void
  onReadToggle: (row: ThreadSummary) => void
  onStarToggle: (row: ThreadSummary) => void
  onNotSpam: (row: ThreadSummary) => void
  onUnsnooze: (row: ThreadSummary) => void
  onDeleteDraft: (row: ThreadSummary) => void
}

export function MailListRow({
  row,
  folder,
  onOpen,
  onReadToggle,
  onStarToggle,
  onNotSpam,
  onUnsnooze,
  onDeleteDraft
}: MailListRowProps): React.JSX.Element {
  return (
    <li className={row.unreadCount > 0 ? 'unread' : undefined}>
      <button
        type="button"
        onClick={() => onOpen(row)}
        style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%' }}
      >
        {/* Bold is the unread affordance, so the row owns the
            weight through li.unread; the subject itself is plain
            markup. */}
        <span className="email-text">
          {row.subject}
          {row.unreadCount > 1 ? ` (${row.unreadCount})` : ''}
        </span>
        {/* Sender names for the whole conversation, like Gmail's
            participant summary on thread rows. */}
        <div className="from email-text">{row.participants.map(senderNameOf).join(', ')}</div>
        <div className="snippet email-text">{row.snippet}</div>
      </button>
      {folder === 'spam' && (
        <button type="button" onClick={() => onNotSpam(row)}>
          not spam
        </button>
      )}
      {folder === 'snoozed' && (
        <button type="button" onClick={() => onUnsnooze(row)}>
          unsnooze
        </button>
      )}
      {folder === 'drafts' && (
        <button type="button" onClick={() => onDeleteDraft(row)}>
          delete draft
        </button>
      )}
      {folder !== 'drafts' && (
        <>
          <button type="button" onClick={() => onReadToggle(row)}>
            {row.unreadCount > 0 ? 'mark read' : 'mark unread'}
          </button>
          <button
            type="button"
            className={`star-toggle${row.starred ? ' starred' : ''}`}
            onClick={() => onStarToggle(row)}
            title={row.starred ? 'Unstar' : 'Star'}
            aria-label={row.starred ? 'Unstar' : 'Star'}
            aria-pressed={row.starred}
          >
            {/* The star glyph is a closed contour drawn unfilled by
                the icon set; filling it with the row's gold when
                starred is the whole state read. */}
            <HugeiconsIcon
              icon={StarIcon}
              size={18}
              strokeWidth={1.8}
              fill={row.starred ? 'currentColor' : 'none'}
            />
          </button>
        </>
      )}
    </li>
  )
}
