import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ThreadSummary,
  EmailDetail as EmailDetailData,
  EmailThread,
  MailLabel,
  MailFolder
} from '../../../shared/types'
import { HugeiconsIcon } from '@hugeicons/react'
import { AlarmClockIcon } from '@hugeicons/core-free-icons'
import { errorMessage, senderNameOf } from '../lib/format'
import { SNOOZE_PRESETS } from '../lib/snooze'
import { ThreadReplyComposer, type ThreadReplyComposerHandle } from './ThreadReplyComposer'
import { MessageAttachments } from './MessageAttachments'
import { sanitizeEmailHtml } from '../lib/emailHtml'

// Folders where report spam makes sense: drafts and sent (mail you own),
// spam itself, and Trash are the excluded rest. A user-label view behaves
// like All Mail: spam reporting is a valid action there.
const REPORT_SPAM_FOLDERS: MailFolder[] = ['inbox', 'all', 'starred', 'label']

// Snoozing makes exactly where parking leaves Inbox ownership in question:
// the mail-ownership views — the Inbox stack (categories included: their
// mail is INBOX mail with a category label), the ownership-free All Mail,
// and the label views, which mail can reach from any folder. Not the
// write-only folders (sent/draft/spam/trash) or the parked set itself,
// where unsnooze is the verb. No custom datetime picker: the presets are
// the whole snooze surface, and the wake store schedules any future
// moment, so a picker is unbacked follow-up, not a v1 gap.
const SNOOZE_FOLDERS: MailFolder[] = [
  'inbox',
  'all',
  'starred',
  'label',
  'important',
  'social',
  'promotions',
  'updates',
  'forums'
]

type EmailDetailProps = {
  // The row identity: subject, participant summary, and thread-level label
  // state the list already displays. Mutations target its id (thread id).
  thread: ThreadSummary
  folder: MailFolder
  // The user labels the open-thread Labels menu lists.
  labels: MailLabel[]
  // Reports the thread's ID once a list-clearing action (archive, delete)
  // succeeded. List removal is owned by App because the list is one row per
  // thread.
  onThreadRemoved: (threadId: string) => void
  // Reports a thread read-state flip (auto-read on open, manual toggle) so
  // App can move the list rows, which it owns.
  onThreadReadChanged: (threadId: string, unread: boolean) => void
  // Reports a thread star flip so App can restyle or drop list rows.
  onThreadStarChanged: (threadId: string, starred: boolean) => void
  // Reports a user-label apply/remove on the open thread so App can refresh
  // the rail's totals and drop a row the active label view lost.
  onThreadLabelChanged: (threadId: string, labelId: string, applied: boolean) => void
}

function fitFrame(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument
  if (!doc) return
  // Collapse first so scrollHeight reflects the content height, not the
  // iframe's default viewport height. Otherwise short emails keep a tall
  // minimum height of empty space.
  frame.style.height = '0px'
  const height = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0)
  frame.style.height = `${height}px`
}

function ThreadMessage({
  message,
  expanded,
  onToggle
}: {
  message: EmailDetailData
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const sanitizedHtml = useMemo(() => sanitizeEmailHtml(message.bodyHtml ?? ''), [message.bodyHtml])

  const emailDocument = `<!doctype html>
<html>
  <head>
    <style>
      html, body {
        margin: 0;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,"Helvetica Neue", Arial, sans-serif;
      }
      /* Sender markup often carries huge intrinsic or authored sizes; like
         Gmail, cap images to the pane width and keep their aspect ratio,
         but never upscale small ones. !important beats sender styling,
         and tables are capped too: a layout table wants its authored
         width, which sizes the cell the img cap resolves against —
         without it a 3000px table still rendered the image at 3000px. */
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      table {
        max-width: 100% !important;
      }
    </style>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';"
    >
  </head>
  <body>${sanitizedHtml}</body>
</html>`

  return (
    <article
      style={{ border: '1px solid #ddd', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%' }}
      >
        <div style={{ padding: '8px 12px', background: '#f6f6f6' }}>
          <div>
            <strong>{senderNameOf(message.from)}</strong> <span>{message.date}</span>
          </div>
          <div style={{ opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {expanded ? message.from : message.snippet}
          </div>
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '8px 12px' }}>
          {message.to && <div>To: {message.to}</div>}
          {message.cc && <div>Cc: {message.cc}</div>}
          {message.bcc && <div>Bcc: {message.bcc}</div>}
          {message.replyTo && <div>Reply-To: {message.replyTo}</div>}
          {message.bodyHtml ? (
            <iframe
              title={`Email content ${message.id}`}
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              srcDoc={emailDocument}
              onLoad={(event) => {
                const frame = event.currentTarget
                fitFrame(frame)
                // Images may finish loading after onLoad and change the height.
                frame.contentDocument?.querySelectorAll('img').forEach((img) => {
                  if (!img.complete)
                    img.addEventListener('load', () => fitFrame(frame), { once: true })
                })
              }}
              style={{ width: '100%', border: 0, display: 'block' }}
            />
          ) : message.bodyText ? (
            <pre style={{ whiteSpace: 'pre-wrap' }}>{message.bodyText}</pre>
          ) : (
            <div className="snippet">{message.snippet}</div>
          )}

          {/* The message's own files, below the body like Gmail's read
              view; each chip saves itself through the native dialog. The
              key remounts per message, so the preview map stays that
              message's fetch-once state. */}
          <MessageAttachments key={message.id} message={message} />
        </div>
      )}
    </article>
  )
}

export function EmailDetail({
  thread,
  folder,
  labels,
  onThreadRemoved,
  onThreadReadChanged,
  onThreadStarChanged,
  onThreadLabelChanged
}: EmailDetailProps): React.JSX.Element {
  const [threadData, setThreadData] = useState<EmailThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // The reply/forward composer lives in ThreadReplyComposer below; EmailDetail
  // holds only its handle for the toolbar's three entry points.
  const replyApi = useRef<ThreadReplyComposerHandle | null>(null)

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [changingSpam, setChangingSpam] = useState(false)
  const [spamError, setSpamError] = useState<string | null>(null)

  const [changingSnooze, setChangingSnooze] = useState(false)
  const [snoozeError, setSnoozeError] = useState<string | null>(null)
  // The snooze affordance opens into Gmail's preset choices; the presets
  // collapse again on pick, on exit through a successful park, and on failure.
  const [pickingSnooze, setPickingSnooze] = useState(false)

  const [togglingRead, setTogglingRead] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)

  const [togglingStar, setTogglingStar] = useState(false)
  const [starError, setStarError] = useState<string | null>(null)

  const [labelsMenuOpen, setLabelsMenuOpen] = useState(false)
  const [togglingLabel, setTogglingLabel] = useState<string | null>(null)
  const [labelError, setLabelError] = useState<string | null>(null)

  // One auto-read attempt per opened email: the ref records the thread id so
  // re-renders don't re-fire the labels.modify call. A failed attempt stays
  // recorded — retrying on every render would spam the quota on persistent
  // errors, and the row stays bold until the manual toggle below succeeds.
  const autoReadRef = useRef<string | null>(null)

  useEffect(() => {
    if (thread.unreadCount === 0 || !thread.id || autoReadRef.current === thread.id) return
    autoReadRef.current = thread.id
    window.api
      .modifyLabels({ kind: 'thread', id: thread.id, removeLabelIds: ['UNREAD'] })
      .then(() => onThreadReadChanged(thread.id, false))
      .catch(() => {})
  }, [thread.id, thread.unreadCount, onThreadReadChanged])

  async function handleToggleRead(): Promise<void> {
    if (togglingRead) return
    setTogglingRead(true)
    setReadError(null)
    const unread = thread.unreadCount > 0
    try {
      await window.api.modifyLabels({
        kind: 'thread',
        id: thread.id,
        ...(unread ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] })
      })
      onThreadReadChanged(thread.id, !unread)
    } catch (error) {
      setReadError(errorMessage(error))
    } finally {
      setTogglingRead(false)
    }
  }

  async function handleToggleStar(): Promise<void> {
    if (togglingStar) return
    setTogglingStar(true)
    setStarError(null)
    try {
      await window.api.modifyLabels({
        kind: 'thread',
        id: thread.id,
        ...(thread.starred ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] })
      })
      onThreadStarChanged(thread.id, !thread.starred)
    } catch (error) {
      setStarError(errorMessage(error))
    } finally {
      setTogglingStar(false)
    }
  }

  // Labels are thread mutations like read and star above, so threads.modify
  // with the label id applies or removes it across the thread's messages.
  async function handleLabelToggle(label: MailLabel): Promise<void> {
    if (togglingLabel) return
    setTogglingLabel(label.id)
    setLabelError(null)
    const applied = (threadData?.labelIds ?? []).includes(label.id)
    try {
      await window.api.modifyLabels({
        kind: 'thread',
        id: thread.id,
        ...(applied ? { removeLabelIds: [label.id] } : { addLabelIds: [label.id] })
      })
      // The menu's checked state is the thread's own label list; both sides
      // of the toggle flip it in place, so reopening is cheap and honest.
      setThreadData((prev) =>
        prev
          ? {
              ...prev,
              labelIds: applied
                ? prev.labelIds.filter((id) => id !== label.id)
                : [...prev.labelIds, label.id]
            }
          : prev
      )
      onThreadLabelChanged(thread.id, label.id, !applied)
    } catch (error) {
      setLabelError(errorMessage(error))
    } finally {
      setTogglingLabel(null)
    }
  }

  // Thread state is reset by remounting via key={thread.id} in App.
  async function loadThread(threadId: string, silent = false): Promise<void> {
    if (!silent) setThreadLoading(true)
    setThreadError(null)
    try {
      const result = await window.api.getThread(threadId)
      setThreadData(result)
      // Default: only the latest message expanded.
      const latestId = result.messages[result.messages.length - 1]?.id
      setExpandedIds(new Set(latestId ? [latestId] : []))
    } catch (error) {
      setThreadError(errorMessage(error))
    } finally {
      if (!silent) setThreadLoading(false)
    }
  }

  useEffect(() => {
    if (!thread.id) return
    // The first loadThread statements run synchronously inside this effect;
    // the lint rule flags it, but the old same-shape effect behaved the way
    // this one does.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadThread(thread.id)
  }, [thread.id])

  const messages: EmailDetailData[] = threadData?.messages ?? []

  async function handleArchive(): Promise<void> {
    if (archiving) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await window.api.modifyLabels({
        kind: 'thread',
        id: thread.id,
        removeLabelIds: ['INBOX']
      })
      onThreadRemoved(thread.id)
    } catch (error) {
      setArchiveError(errorMessage(error))
    } finally {
      setArchiving(false)
    }
  }

  // Trash, like archive, is a label mutation: add TRASH, remove INBOX. The
  // draft, trash, and spam folders are excluded because trashing a draft
  // thread leaves it in drafts.list, an already-trashed thread has nothing
  // to mutate, and trashed but spammed mail would still paginate from Spam.
  async function handleDelete(): Promise<void> {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await window.api.modifyLabels({
        kind: 'thread',
        id: thread.id,
        addLabelIds: ['TRASH'],
        removeLabelIds: ['INBOX']
      })
      onThreadRemoved(thread.id)
    } catch (error) {
      setDeleteError(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  // Spam state is one label too: reporting adds SPAM and drops INBOX, and
  // unreporting does the reverse and restores INBOX. Both sides clear the
  // thread from the current list, like archive and trash above, so one
  // handler carries the pending/error state for either direction.
  async function handleSetSpam(isSpam: boolean): Promise<void> {
    if (changingSpam) return
    setChangingSpam(true)
    setSpamError(null)
    try {
      await window.api.modifyLabels({
        kind: 'thread',
        id: thread.id,
        addLabelIds: [isSpam ? 'SPAM' : 'INBOX'],
        removeLabelIds: [isSpam ? 'INBOX' : 'SPAM']
      })
      onThreadRemoved(thread.id)
    } catch (error) {
      setSpamError(errorMessage(error))
    } finally {
      setChangingSpam(false)
    }
  }

  // Unsnooze is Gmail's own "move to Inbox": the write is an INBOX add, and
  // that alone is what ends the parking state. SNOOZED is a pseudo-label the
  // API refuses as a label mutation (400 "Invalid label"), so there is no
  // reverse pair to send — re-adding the mail to the Inbox is the whole
  // unsnooze. Mail parked by Mailsy instead carries its user label, and the
  // restore verb takes the reverse pair with it (and clears the wake
  // schedule); the wrong verb here would leave the rail showing a
  // half-unsnoozed thread. The thread clears from the Snoozed list either way.
  async function handleUnsnooze(): Promise<void> {
    if (changingSnooze) return
    setChangingSnooze(true)
    setSnoozeError(null)
    try {
      if (thread.snoozedByMailsy) {
        await window.api.restoreThread(thread.id)
      } else {
        await window.api.modifyLabels({ kind: 'thread', id: thread.id, addLabelIds: ['INBOX'] })
      }
      onThreadRemoved(thread.id)
    } catch (error) {
      setSnoozeError(errorMessage(error))
    } finally {
      setChangingSnooze(false)
    }
  }

  // Snoozing parks the thread out of the Inbox for the chosen preset: main
  // tags it 'Snoozed by Mailsy' and persists the wake time, so the row
  // leaves this list the way archive and delete leave theirs.
  async function handleSnooze(restoreAt: number): Promise<void> {
    if (changingSnooze) return
    setChangingSnooze(true)
    setSnoozeError(null)
    setPickingSnooze(false)
    try {
      await window.api.snoozeThread(thread.id, restoreAt)
      onThreadRemoved(thread.id)
    } catch (error) {
      setSnoozeError(errorMessage(error))
    } finally {
      setChangingSnooze(false)
    }
  }

  function toggleMessage(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <h2>{thread.subject}</h2>
      <div>
        <div>{thread.participants.map(senderNameOf).join(', ')}</div>
        <div>{thread.date}</div>
        {messages.length > 1 && <div>{messages.length} messages in conversation</div>}
        <button
          type="button"
          className={`star-toggle${thread.starred ? ' starred' : ''}`}
          onClick={handleToggleStar}
          disabled={togglingStar}
          aria-pressed={thread.starred}
        >
          {thread.starred ? 'starred' : 'not starred'}
        </button>
      </div>

      {threadLoading ? (
        <p>Loading email...</p>
      ) : threadError ? (
        <p role="alert">{threadError}</p>
      ) : messages.length > 0 ? (
        <div>
          {messages.map((message) => (
            <ThreadMessage
              key={message.id}
              message={message}
              expanded={expandedIds.has(message.id)}
              onToggle={() => toggleMessage(message.id)}
            />
          ))}
        </div>
      ) : (
        <div className="snippet">{thread.snippet}</div>
      )}

      {/* Gmail's Labels menu: the open thread's apply/remove affordance, one
          checkbox per user label, checked from the thread's own label set. */}
      <div className="labels-menu">
        <button
          type="button"
          onClick={() => setLabelsMenuOpen(!labelsMenuOpen)}
          disabled={threadLoading || Boolean(threadError)}
          aria-expanded={labelsMenuOpen}
        >
          Labels
        </button>
        {labelsMenuOpen &&
          (threadData ? (
            <div className="labels-menu-list" role="group" aria-label="Apply labels">
              {labels.length === 0 && <p className="snippet">No user labels yet.</p>}
              {labels.map((label) => (
                <label key={label.id} className="labels-menu-item">
                  <input
                    type="checkbox"
                    checked={threadData.labelIds.includes(label.id)}
                    disabled={threadLoading || Boolean(threadError) || togglingLabel === label.id}
                    onChange={() => handleLabelToggle(label)}
                  />
                  {/* The label's color reads as the chip next to the name,
                    the same signal the rail carries. */}
                  <span
                    className="labels-menu-dot"
                    style={{ background: label.color?.background ?? '#d9d9d9' }}
                  />
                  {label.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="snippet" role="status">
              Loading labels...
            </p>
          ))}
      </div>
      {labelError && <p role="alert">{labelError}</p>}

      <button onClick={() => replyApi.current?.reply()}>reply</button>
      <button onClick={() => replyApi.current?.replyAll()}>reply all</button>
      <button onClick={() => replyApi.current?.forward()}>forward</button>
      <button onClick={handleToggleRead} disabled={togglingRead}>
        {thread.unreadCount > 0 ? 'mark as read' : 'mark as unread'}
      </button>
      {folder === 'inbox' && (
        <button onClick={handleArchive} disabled={archiving}>
          archive
        </button>
      )}
      {/* Delete is hidden in Snoozed for the same reason it already is in
          Spam: keeping resting mail out of collision-prone mutations. */}
      {folder !== 'trash' && folder !== 'drafts' && folder !== 'spam' && folder !== 'snoozed' && (
        <button onClick={handleDelete} disabled={deleting}>
          delete
        </button>
      )}
      {REPORT_SPAM_FOLDERS.includes(folder) && (
        <button onClick={() => handleSetSpam(true)} disabled={changingSpam}>
          report spam
        </button>
      )}
      {folder === 'spam' && (
        <button onClick={() => handleSetSpam(false)} disabled={changingSpam}>
          not spam
        </button>
      )}
      {SNOOZE_FOLDERS.includes(folder) && (
        <>
          <button
            className="snooze-toggle"
            onClick={() => setPickingSnooze(!pickingSnooze)}
            disabled={changingSnooze}
            aria-expanded={pickingSnooze}
            title="Snooze"
          >
            {/* The park affordance carries the alarm icon the rail's
                Snoozed entry does, so looking for snooze and looking for
                parked mail is the same glyph both places. */}
            <HugeiconsIcon icon={AlarmClockIcon} size={15} strokeWidth={2} />
            snooze
          </button>
          {/* Presets sit in the boxed idiom of the Labels menu above, open
              under the affordance and collapsing on pick or failure. */}
          {pickingSnooze && (
            <div className="snooze-menu-list" role="group" aria-label="Snooze until">
              {SNOOZE_PRESETS.map((preset) => (
                <button key={preset.key} onClick={() => void handleSnooze(preset.at())}>
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {folder === 'snoozed' && (
        <button onClick={handleUnsnooze} disabled={changingSnooze}>
          unsnooze
        </button>
      )}

      {archiveError && <p role="alert">{archiveError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {spamError && <p role="alert">{spamError}</p>}
      {snoozeError && <p role="alert">{snoozeError}</p>}
      {readError && <p role="alert">{readError}</p>}
      {starError && <p role="alert">{starError}</p>}
      {/* The reply/forward composer. Remounts per thread via key in App, so
          its state (including the file set) resets with the conversation. */}
      <ThreadReplyComposer
        ref={replyApi}
        thread={thread}
        messages={messages}
        userEmail={threadData?.userEmail ?? ''}
        onSent={(threadId) => {
          if (threadId) void loadThread(threadId, true)
        }}
      />
    </div>
  )
}
