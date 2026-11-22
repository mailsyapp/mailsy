import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { useReaction } from '../hooks/useReaction'
import type { EmailDetail as EmailDetailData, ThreadSummary } from '../../../shared/types'
import { hasRecipient, type SendEmailRequest } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { quoteHtmlFor } from '../lib/emailHtml'
import { replyAllRecipients } from '../lib/recipients'
import { RecipientFields } from './RecipientFields'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { useComposerAttachments } from './useComposerAttachments'

export interface ThreadReplyComposerHandle {
  reply(): void
  replyAll(): void
  forward(): void
}

type ThreadReplyComposerProps = {
  thread: ThreadSummary
  messages: EmailDetailData[]
  userEmail: string
  onSent: (threadId: string | undefined) => void
}

export const ThreadReplyComposer = forwardRef<ThreadReplyComposerHandle, ThreadReplyComposerProps>(
  function ThreadReplyComposer({ thread, messages, userEmail, onSent }, ref) {
    const latestMessage: EmailDetailData | null = messages[messages.length - 1] ?? null

    const [draft, setDraft] = useState<SendEmailRequest | null>(null)
    const pendingReplyRef = useRef<{ target: EmailDetailData; prefilledTo: string } | null>(null)
    const [quotedContent, setQuotedContent] = useState<{ html: string } | null>(null)
    const [composerSeq, setComposerSeq] = useState(0)
    const bodyRef = useRef<ComposerBodyHandle | null>(null)
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)
    const attach = useComposerAttachments(undefined, bodyRef)
    const { clear: clearAttachments } = attach

    useReaction([userEmail], () => {
      const pending = pendingReplyRef.current
      if (!userEmail || !pending) return
      pendingReplyRef.current = null
      setDraft((prev) => {
        if (!prev || prev.to !== pending.prefilledTo) return prev
        const targets = replyAllRecipients(pending.target, userEmail)
        return { ...prev, to: targets.to, cc: targets.cc }
      })
    })

    const openReplyComposer = useCallback(
      (target: EmailDetailData, toLine: string, ccLine = ''): void => {
        setSendError(null)
        setSent(false)
        clearAttachments()
        const originalText = target.bodyText || target.snippet || thread.snippet

        setQuotedContent({ html: quoteHtmlFor(target, originalText, false) })
        setComposerSeq((prev) => prev + 1)
        setDraft({
          to: toLine,
          ...(ccLine ? { cc: ccLine } : {}),
          subject: /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`,
          body: '',
          threadId: target.threadId || undefined,
          inReplyTo: target.messageId || undefined,
          references: [target.references, target.messageId].filter(Boolean).join(' ') || undefined
        })
      },
      [clearAttachments, thread.snippet]
    )

    const openForwardComposer = useCallback(
      (target: EmailDetailData): void => {
        setSendError(null)
        setSent(false)
        clearAttachments()
        const originalText = target.bodyText || target.snippet || thread.snippet

        setQuotedContent({ html: quoteHtmlFor(target, originalText, true) })
        setComposerSeq((prev) => prev + 1)
        setDraft({
          to: '',
          subject: /^fwd:/i.test(target.subject) ? target.subject : `Fwd: ${target.subject}`,
          body: '',
          threadId: target.threadId || undefined,
          inReplyTo: target.messageId || undefined,
          references: [target.references, target.messageId].filter(Boolean).join(' ') || undefined
        })
      },
      [clearAttachments, thread.snippet]
    )

    useImperativeHandle(
      ref,
      () => ({
        reply: () => {
          const target = latestMessage
          if (!target) return
          openReplyComposer(
            target,
            target.replyTo.trim() || target.from.trim() || thread.participants[0] || ''
          )
        },
        replyAll: () => {
          const target = latestMessage
          if (!target) return
          const { to, cc } = replyAllRecipients(target, userEmail)
          openReplyComposer(target, to, cc)
          pendingReplyRef.current = userEmail ? null : { target, prefilledTo: to }
        },
        forward: () => {
          const target = latestMessage
          if (!target) return
          openForwardComposer(target)
        }
      }),
      [thread, latestMessage, userEmail, openReplyComposer, openForwardComposer]
    )

    async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
      event.preventDefault()
      if (!draft || sending || !hasRecipient(draft)) return

      setSending(true)
      setSendError(null)
      setSent(false)
      try {
        await window.api.sendEmail({ ...draft, ...attach.field })
        setDraft(null)
        setQuotedContent(null)
        setSent(true)
        onSent(latestMessage?.threadId ?? thread.id)
      } catch (error) {
        setSendError(errorMessage(error))
      } finally {
        setSending(false)
      }
    }

    return (
      <>
        {draft && (
          <form
            className={`composer${attach.dropping ? ' composer-dragging' : ''}`}
            onSubmit={handleSend}
            {...attach.drop}
          >
            <h2 id="composer-title">Compose email</h2>

            <RecipientFields
              to={draft.to}
              cc={draft.cc ?? ''}
              bcc={draft.bcc ?? ''}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
            />

            <label className="composerField">
              <span>Subject</span>
              <input
                value={draft.subject}
                onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              />
            </label>

            <ComposerBody
              ref={bodyRef}
              attach={attach}
              remountKey={composerSeq}
              initialHtml={quotedContent?.html ?? ''}
              onBodyChange={(content) =>
                setDraft((prev) =>
                  prev ? { ...prev, body: content.text, bodyHtml: content.html || undefined } : prev
                )
              }
            />

            {sendError && <p role="alert">{sendError}</p>}

            <div className="composerActions">
              <button
                type="button"
                onClick={() => {
                  setDraft(null)
                  setQuotedContent(null)
                  attach.clear()
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={sending || !hasRecipient(draft)}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        )}
        {sent && <p role="status">Message sent.</p>}
      </>
    )
  }
)
