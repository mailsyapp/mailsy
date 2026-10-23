import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { AutoGrowTextarea } from './AutoGrowTextarea'
import type {
  ThreadSummary,
  EmailDetail as EmailDetailData,
  EmailThread,
  SendEmailRequest,
  MailFolder
} from '../../../shared/types'
import { senderNameOf } from '../lib/format'
import { replyAllTargets } from '../lib/recipients'

type EmailDetailProps = {
  // The row identity: subject, participant summary, and thread-level label
  // state the list already displays. Mutations target its id (thread id).
  thread: ThreadSummary
  folder: MailFolder
  // Reports the thread's ID once a list-clearing action (archive, delete)
  // succeeded. List removal is owned by App because the list is one row per
  // thread.
  onThreadRemoved: (threadId: string) => void
  // Reports a thread read-state flip (auto-read on open, manual toggle) so
  // App can move the list rows, which it owns.
  onThreadReadChanged: (threadId: string, unread: boolean) => void
  // Reports a thread star flip so App can restyle or drop list rows.
  onThreadStarChanged: (threadId: string, starred: boolean) => void
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character] ?? character
  })
}

function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'iframe',
      'frame',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'textarea',
      'select'
    ]
  })
}

// Gmail renders the elided-quote affordance only for its own native quote
// markup: a gmail_quote_container div holding a gmail_attr attribution line
// and a gmail_quote blockquote. Anything else shows as literal text.
const QUOTE_BLOCKQUOTE_STYLE =
  'margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex'

function buildQuoteHtml(attrHtml: string, originalHtml: string, originalText: string): string {
  const inner = originalHtml || plainTextToHtml(originalText)
  return `<div class="gmail_quote gmail_quote_container"><div class="gmail_attr">${attrHtml}</div><blockquote class="gmail_quote" style="${QUOTE_BLOCKQUOTE_STYLE}">${inner}</blockquote></div>`
}

function gmailDateOf(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed)
}

function formatDraftHtml(body: string, quoteText: string, quoteHtml: string): string {
  if (!quoteText) return plainTextToHtml(body)

  const quoteStart = body.indexOf(quoteText)
  if (quoteStart === -1) return plainTextToHtml(body)

  const quoteEnd = quoteStart + quoteText.length
  return (
    plainTextToHtml(body.slice(0, quoteStart)) + quoteHtml + plainTextToHtml(body.slice(quoteEnd))
  )
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
        </div>
      )}
    </article>
  )
}

export function EmailDetail({
  thread,
  folder,
  onThreadRemoved,
  onThreadReadChanged,
  onThreadStarChanged
}: EmailDetailProps): React.JSX.Element {
  const [threadData, setThreadData] = useState<EmailThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [draft, setDraft] = useState<SendEmailRequest | null>(null)
  // Set only when a reply-all opened without the account address; the
  // arrival effect clears it after its at-most-once rewrite.
  const pendingReplyRef = useRef<{ target: EmailDetailData; toLine: string } | null>(null)
  const [quotedContent, setQuotedContent] = useState<{ text: string; html: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [togglingRead, setTogglingRead] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)

  const [togglingStar, setTogglingStar] = useState(false)
  const [starError, setStarError] = useState<string | null>(null)

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
      setReadError(error instanceof Error ? error.message : String(error))
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
      setStarError(error instanceof Error ? error.message : String(error))
    } finally {
      setTogglingStar(false)
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
      setThreadError(error instanceof Error ? error.message : String(error))
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

  const accountEmail = threadData?.userEmail
  useEffect(() => {
    const pending = pendingReplyRef.current
    if (!accountEmail || !pending) return
    pendingReplyRef.current = null
    // Only the exact prefill the unknown address produced is rewritten; an
    // edited To line means the user already took the list from here.
    setDraft((prev) =>
      prev && prev.to === pending.toLine
        ? { ...prev, to: replyAllTargets(pending.target, accountEmail) }
        : prev
    )
  }, [accountEmail])

  const messages: EmailDetailData[] = threadData?.messages ?? []

  const latestMessage: EmailDetailData | null = messages[messages.length - 1] ?? null

  function openReplyComposer(target: EmailDetailData, toLine: string): void {
    setSendError(null)
    setSent(false)
    const originalText = target.bodyText || target.snippet || thread.snippet
    const quotedText = `On ${target.date}, ${target.from} wrote:\n${originalText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`
    const quotedHtml = buildQuoteHtml(
      `On ${escapeHtml(gmailDateOf(target.date))}, ${escapeHtml(target.from)} wrote:<br>`,
      target.bodyHtml ? sanitizeEmailHtml(target.bodyHtml) : '',
      originalText
    )

    setQuotedContent({ text: quotedText, html: quotedHtml })
    setDraft({
      to: toLine,
      subject: /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`,
      body: `\n\n${quotedText}`,
      threadId: target.threadId || undefined,
      inReplyTo: target.messageId || undefined,
      references: [target.references, target.messageId].filter(Boolean).join(' ') || undefined
    })
  }

  function replyToEmail(): void {
    const target = latestMessage
    if (!target) return
    openReplyComposer(
      target,
      target.replyTo.trim() || target.from.trim() || thread.participants[0] || ''
    )
  }

  function replyAllToEmail(): void {
    const target = latestMessage
    if (!target) return
    const userEmail = threadData?.userEmail ?? ''
    const toLine = replyAllTargets(target, userEmail)
    openReplyComposer(target, toLine)
    // A reply-all opened before the account address landed prefilters
    // nothing: when it arrives, an untouched To line gets one rewrite.
    pendingReplyRef.current = userEmail ? null : { target, toLine }
  }

  function forwardEmail(): void {
    const target = latestMessage
    if (!target) return

    setSendError(null)
    setSent(false)
    const originalText = target.bodyText || target.snippet || thread.snippet
    const forwardHeader = [
      '---------- Forwarded message ----------',
      `From: ${target.from}`,
      `To: ${target.to}`,
      `Date: ${target.date}`,
      `Subject: ${target.subject}`
    ].join('\n')
    const quotedText = `${forwardHeader}\n\n${originalText}`
    const forwardAttrHtml = [
      '---------- Forwarded message ---------',
      `From: ${target.from}`,
      `To: ${target.to}`,
      `Date: ${target.date}`,
      `Subject: ${target.subject}`
    ]
      .map(escapeHtml)
      .join('<br>')
      .concat('<br><br>')
    const quotedHtml = buildQuoteHtml(
      forwardAttrHtml,
      target.bodyHtml ? sanitizeEmailHtml(target.bodyHtml) : '',
      originalText
    )

    setQuotedContent({ text: quotedText, html: quotedHtml })
    setDraft({
      to: '',
      subject: /^fwd:/i.test(target.subject) ? target.subject : `Fwd: ${target.subject}`,
      body: `\n\n${quotedText}`,
      // Keep the forward in the same Gmail thread so it shows up in the
      // conversation view alongside the original + replies.
      threadId: target.threadId || undefined,
      inReplyTo: target.messageId || undefined,
      references: [target.references, target.messageId].filter(Boolean).join(' ') || undefined
    })
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!draft || sending) return

    setSending(true)
    setSendError(null)
    setSent(false)
    try {
      await window.api.sendEmail({
        ...draft,
        ...(quotedContent
          ? { bodyHtml: formatDraftHtml(draft.body, quotedContent.text, quotedContent.html) }
          : {})
      })
      setDraft(null)
      setQuotedContent(null)
      setSent(true)
      // Refresh the conversation so the just-sent reply/forward is visible.
      const threadId = latestMessage?.threadId ?? thread.id
      if (threadId) await loadThread(threadId, true)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

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
      setArchiveError(error instanceof Error ? error.message : String(error))
    } finally {
      setArchiving(false)
    }
  }

  // Trash, like archive, is a label mutation: add TRASH, remove INBOX. The
  // draft and trash folders are excluded because trashing a draft thread
  // leaves it in drafts.list, and an already-trashed thread has nothing to
  // mutate.
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
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeleting(false)
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

      <button onClick={replyToEmail}>reply</button>
      <button onClick={replyAllToEmail}>reply all</button>
      <button onClick={forwardEmail}>forward</button>
      <button onClick={handleToggleRead} disabled={togglingRead}>
        {thread.unreadCount > 0 ? 'mark as read' : 'mark as unread'}
      </button>
      {folder === 'inbox' && (
        <button onClick={handleArchive} disabled={archiving}>
          archive
        </button>
      )}
      {folder !== 'trash' && folder !== 'drafts' && (
        <button onClick={handleDelete} disabled={deleting}>
          delete
        </button>
      )}

      {archiveError && <p role="alert">{archiveError}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}
      {readError && <p role="alert">{readError}</p>}
      {starError && <p role="alert">{starError}</p>}

      {draft && (
        <form className="composer" onSubmit={handleSend}>
          <h2 id="composer-title">Compose email</h2>

          <label className="composerField">
            <span>To</span>
            <input
              required
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>

          <label className="composerField">
            <span>Subject</span>
            <input
              value={draft.subject}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            />
          </label>

          <label className="composerField">
            <span>Message</span>
            <AutoGrowTextarea
              rows={5}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>

          {sendError && <p role="alert">{sendError}</p>}

          <div className="composerActions">
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setQuotedContent(null)
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={sending || !draft.to.trim()}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      )}
      {sent && <p role="status">Message sent.</p>}
    </div>
  )
}
