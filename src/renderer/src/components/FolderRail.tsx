import { useEffect, useRef, useState } from 'react'
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

// The dwell before a rail tooltip shows, matching the native-tooltip
// standard (~0.5s rest before the hint appears).
const TOOLTIP_DWELL_MS = 500

const FOLDERS: Array<{ id: MailFolder; label: string; icon: LucideIcon }> = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'snoozed', label: 'Snoozed', icon: AlarmClock },
  // Gmail's category stack, Important first, the four inbox tabs after it.
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

// One chip per user label, held together by the count it opens: the body
// carries the label's Gmail background color and text color, the count the
// thread total, and the corner holds the delete affordance. Selecting and
// deleting must be separate elements because a click target that is also a
// nested button is not renderable.
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
  // The rail has two widths, collapsed (icon-only, default) and expanded
  // (~220px rows): renderer-local presentation like labelsShown below,
  // nothing persisted. Expanded makes the label section permanently
  // visible, so labelsShown only gates the collapsed rail's Tag toggle.
  const [expanded, setExpanded] = useState(false)
  // Collapsed mode keeps the Label chips behind a toggle (the user called
  // the always-on chips out as clutter on 2026-10-20): the Tags button
  // reveals them without overflowing the 56px column. Expanded mode above
  // is the only always-visible chips surface.
  const [labelsShown, setLabelsShown] = useState(false)
  // Tooltip dwell, the wait-then-costs-nothing-again rule: the first tip
  // shows only after the pointer rests TOOLTIP_DWELL_MS on an affordance
  // (the CSS transition-delay carries the wait), and once one tip is up
  // the .tips-active class ends the wait for the rest of the rail —
  // moving down the rail must not re-charge 0.5s on every neighbor, or
  // reading the column feels like a slot machine. Leaving the rail
  // revokes the mode so a fresh visit pays the wait again. The class is
  // managed by ref, never React state: hover churn would re-render the
  // whole folder list for a purely pointer-visual change.
  const railRef = useRef<HTMLElement | null>(null)
  const tipTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      // Unmount mid-dwell must not leave a timer that mutates a dead node.
      if (tipTimerRef.current !== null) window.clearTimeout(tipTimerRef.current)
    },
    []
  )

  function handleTipHover(event: React.MouseEvent<HTMLElement>): void {
    const rail = railRef.current
    if (!rail) return
    if (tipTimerRef.current !== null) {
      window.clearTimeout(tipTimerRef.current)
      tipTimerRef.current = null
    }
    // Mode is already on (neighbor switches pay nothing) or the pointer
    // is over a tipless node (chips container, create input): nothing to
    // charge or grant.
    if (rail.classList.contains('tips-active')) return
    if (!(event.target instanceof Element)) return
    if (!event.target.closest('[data-tip]')) return
    tipTimerRef.current = window.setTimeout(() => {
      tipTimerRef.current = null
      rail.classList.add('tips-active')
    }, TOOLTIP_DWELL_MS)
  }

  function handleTipLeave(): void {
    // A dwell that never elapsed is cancelled, not banked; leaving the
    // rail entirely also ends the already-paid mode.
    if (tipTimerRef.current !== null) {
      window.clearTimeout(tipTimerRef.current)
      tipTimerRef.current = null
    }
    railRef.current?.classList.remove('tips-active')
  }

  function commitDraft(): void {
    const name = draftName.trim()
    if (!name) return
    onCreateLabel(name)
    setDraftName('')
    setDraftOpen(false)
  }

  // Expanded shows the label section permanently; collapsed keeps the
  // existing Tag-toggle gate.
  const labelsVisible = expanded || labelsShown

  // Selecting any view folds the drawer: it is an overlay over the mail,
  // not a column of the layout, so a chosen destination gets the whole
  // width back the moment it opens. Collapsed selection collapses a
  // drawer that is already closed, which is nothing.
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
            // Expanded rows read as text already; a tip would only repeat
            // the label next to itself. The aria-label stays on either
            // way: the mobile media query hides the text span, so the
            // accessible name cannot live in the visible content alone.
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
          // A label view is active and the collapsed rail keeps its chips
          // tucked away: the rail still has to say which view it is on,
          // so the label takes the Tag toggle's place as a small tile in
          // the label's own color carrying its first three letters (two
          // identities on the tile, none on a plain highlight). Clicking
          // it opens the same labels surface the Tag toggle opens.
          <button
            type="button"
            className="active-label-tile"
            data-tip={`Labels: ${activeLabel.name}`}
            aria-label={`Labels: ${activeLabel.name}`}
            aria-expanded={false}
            style={{ background: activeLabel.color?.background ?? '#d9d9d9' }}
            onClick={() => setLabelsShown(true)}
          >
            <Tag
              size={9}
              strokeWidth={2.6}
              aria-hidden="true"
              style={{ color: activeLabel.color?.text ?? '#000000' }}
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
              setDraftOpen(true)
              // autofocus fires on mount, but an already-visited draft may
              // not re-run it; focus explicitly too.
              requestAnimationFrame(() => draftRef.current?.focus())
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
