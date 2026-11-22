import { useRef, useState } from 'react'
import { useTimers } from '../hooks/useTimers'
import {
  AlarmClock,
  Flag,
  Inbox,
  Info,
  Mail,
  Megaphone,
  MessagesSquare,
  OctagonAlert,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  SquarePen,
  Star,
  Tag,
  Trash2,
  Users,
  X,
  type LucideIcon
} from 'lucide-react'
import type { MailFolder, MailLabel } from '../../../shared/types'

const TOOLTIP_DWELL_MS = 500
const TOOLTIP_TIMER = 'tooltip-dwell'

const FOLDERS: Array<{ id: MailFolder; label: string; icon: LucideIcon }> = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'snoozed', label: 'Snoozed', icon: AlarmClock },
  { id: 'important', label: 'Important', icon: Flag },
  { id: 'social', label: 'Social', icon: Users },
  { id: 'promotions', label: 'Promotions', icon: Megaphone },
  { id: 'updates', label: 'Updates', icon: Info },
  { id: 'forums', label: 'Forums', icon: MessagesSquare },
  { id: 'drafts', label: 'Drafts', icon: SquarePen },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'spam', label: 'Spam', icon: OctagonAlert },
  { id: 'trash', label: 'Trash', icon: Trash2 },
  { id: 'all', label: 'All Mail', icon: Mail }
]

function UserLabelChip({
  label,
  expanded,
  isActive,
  onSelect,
  onDelete
}: {
  label: MailLabel
  expanded: boolean
  isActive: boolean
  onSelect: (label: MailLabel) => void
  onDelete: (label: MailLabel) => void
}): React.JSX.Element {
  const color = label.color ?? { background: '#d9d9d9', text: '#000000' }
  const count = label.threadsTotal > 0 ? label.threadsTotal : ''
  return (
    <div className={`user-label-chip${isActive ? ' active' : ''}`}>
      <button
        type="button"
        className="user-label-chip-open"
        data-tip={expanded ? undefined : label.name}
        aria-label={label.name}
        aria-current={isActive ? 'page' : undefined}
        style={
          {
            '--chip-bg': color.background,
            '--chip-text': color.text
          } as React.CSSProperties
        }
        onClick={() => onSelect(label)}
      >
        {expanded ? (
          <>
            <span
              className="user-label-chip-dot"
              style={{ background: color.background }}
              aria-hidden="true"
            />
            <span className="user-label-chip-name">{label.name}</span>
            <span className="user-label-chip-count">{count}</span>
          </>
        ) : (
          count
        )}
      </button>
      <button
        type="button"
        className="user-label-chip-remove"
        data-tip={`Delete label ${label.name}`}
        aria-label={`Delete ${label.name}`}
        onClick={() => onDelete(label)}
      >
        <X size={10} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  )
}

interface FolderRailProps {
  activeFolder: MailFolder
  activeLabelId: string | null
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
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const draftRef = useRef<HTMLInputElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [labelsShown, setLabelsShown] = useState(false)
  const railRef = useRef<HTMLElement | null>(null)
  const tipTimers = useTimers()

  function handleTipHover(event: React.MouseEvent<HTMLElement>): void {
    const rail = railRef.current
    if (!rail) return
    tipTimers.cancel(TOOLTIP_TIMER)
    if (rail.classList.contains('tips-active')) return
    if (!(event.target instanceof Element)) return
    if (!event.target.closest('[data-tip]')) return
    tipTimers.start(TOOLTIP_TIMER, TOOLTIP_DWELL_MS, () => rail.classList.add('tips-active'))
  }

  function handleTipLeave(): void {
    tipTimers.cancel(TOOLTIP_TIMER)
    railRef.current?.classList.remove('tips-active')
  }

  function commitDraft(): void {
    const name = draftName.trim()
    if (!name) return
    onCreateLabel(name)
    setDraftName('')
    setDraftOpen(false)
  }

  const labelsVisible = expanded || labelsShown

  function selectFolder(folder: MailFolder): void {
    onSelect(folder)
    setExpanded(false)
  }

  function selectLabel(label: MailLabel): void {
    onSelectLabel(label)
    setExpanded(false)
  }

  const activeLabel =
    activeLabelId !== null ? labels.find((label) => label.id === activeLabelId) : undefined

  return (
    <nav
      className={`folder-rail${expanded ? ' expanded' : ''}`}
      aria-label="Mail folders"
      ref={railRef}
      onMouseOver={handleTipHover}
      onMouseLeave={handleTipLeave}
    >
      <button
        type="button"
        className="folder-rail-button rail-toggle"
        data-tip={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
      >
        {expanded ? (
          <PanelLeftClose size={22} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <PanelLeftOpen size={22} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {FOLDERS.map((folder) => {
        const isActive = folder.id === activeFolder && activeLabelId === null
        return (
          <button
            key={folder.id}
            type="button"
            className={`folder-rail-button${isActive ? ' active' : ''}${expanded ? ' expanded' : ''}`}
            data-tip={expanded ? undefined : folder.label}
            aria-label={folder.label}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => selectFolder(folder.id)}
          >
            <folder.icon size={22} strokeWidth={1.8} aria-hidden="true" />
            {expanded && <span className="folder-rail-button-text">{folder.label}</span>}
          </button>
        )
      })}
      {!expanded &&
        (activeLabel ? (
          <button
            type="button"
            className="active-label-tile"
            data-tip={`Labels: ${activeLabel.name}`}
            aria-label={`Labels: ${activeLabel.name}`}
            aria-expanded={false}
            onClick={() => setLabelsShown(true)}
          >
            <span
              className="active-label-tile-glyph"
              aria-hidden="true"
              style={{ background: activeLabel.color?.background ?? '#d9d9d9' }}
            />
            <span
              className="active-label-tile-text"
              style={{ color: activeLabel.color?.text ?? '#000000' }}
            >
              {activeLabel.name.slice(0, 3).toUpperCase()}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="folder-rail-button"
            data-tip={labelsShown ? 'Hide labels' : 'Labels'}
            aria-label={labelsShown ? 'Hide labels' : 'Labels'}
            aria-expanded={labelsShown}
            onClick={() => setLabelsShown((shown) => !shown)}
          >
            <Tag size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ))}
      {labelsVisible && (
        <>
          {expanded && <span className="folder-rail-heading">Labels</span>}
          {labels.length > 0 && (
            <div className="user-label-chips" aria-label="User labels">
              {labels.map((label) => (
                <UserLabelChip
                  key={label.id}
                  label={label}
                  expanded={expanded}
                  isActive={label.id === activeLabelId}
                  onSelect={selectLabel}
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
            data-tip={expanded ? undefined : 'New label'}
            onClick={() => {
              if (draftOpen) draftRef.current?.focus()
              else setDraftOpen(true)
            }}
          >
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
            {expanded && <span className="user-label-create-text">New label</span>}
          </button>
        </>
      )}
    </nav>
  )
}
