import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { EmailDetail as EmailDetailData, ThreadSummary } from '../../../shared/types'
import { hasRecipient, type SendEmailRequest } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { quoteHtmlFor } from '../lib/emailHtml'
import { replyAllRecipients } from '../lib/recipients'
import { RecipientFields } from './RecipientFields'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { useComposerAttachments } from './useComposerAttachments'

// The reply/forward composer for the open thread. One component that owns
// the whole form lifecycle: the threading prefill (`draft`), the quote
// prefill and its remount sequence, the attachment set, and the send —
// EmailDetail only wires the three entry points and the post-send
// conversation refresh. Send goes straight through the fresh-send verb:
// the thread linkage rides the payload, so Gmail threads the reply into
// the conversation per its headers.
export interface ThreadReplyComposerHandle {
  reply(): void
  replyAll(): void
  forward(): void
}

type ThreadReplyComposerProps = {
  thread: ThreadSummary
  // The conversation's messages; the composer targets the latest one.
  messages: EmailDetailData[]
  // The account address, when known: a reply-all opened before it arrives
  // gets one recipient rewrite from the arrival effect below.
  userEmail: string
  // The send succeeded. The parent refreshes the conversation with the id.
  onSent: (threadId: string | undefined) => void
}

export const ThreadReplyComposer = forwardRef<ThreadReplyComposerHandle, ThreadReplyComposerProps>(
  function ThreadReplyComposer({ thread, messages, userEmail, onSent }, ref) {
    const latestMessage: EmailDetailData | null = messages[messages.length - 1] ?? null

    const [draft, setDraft] = useState<SendEmailRequest | null>(null)
    // Set only when a reply-all opened without the account address; the
    // arrival effect clears it after its at-most-once rewrite.
    const pendingReplyRef = useRef<{ target: EmailDetailData; prefilledTo: string } | null>(null)
    // The rich body the editor starts with: the quote markup of the current
    // reply/forward. The editor is uncontrolled past this point — typed
    // content lives there, and its onChange keeps the draft payload synced.
    const [quotedContent, setQuotedContent] = useState<{ html: string } | null>(null)
    // Bumped by every reply/forward open, so a new quote remounts the editor
    // even for the same message twice in a row.
    const [composerSeq, setComposerSeq] = useState(0)
    const bodyRef = useRef<ComposerBodyHandle | null>(null)
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)
    // The form's own file set, separate from `draft` so the typed-text
    // payload state keeps being exactly a SendEmailRequest and the files join
    // only when the bridge call leaves. Cancel clears them with the text;
    // App remounts the whole component per thread via key. Image files route
    // into the rich body instead of the chip list, through the body ref the
    // hook holds.
    const attach = useComposerAttachments(undefined, bodyRef)
    // `clear` is the hook's stable callback; the openers below dep on it
    // directly, everything else they use is a state setter.
    const { clear: clearAttachments } = attach

    useEffect(() => {
      const pending = pendingReplyRef.current
      if (!userEmail || !pending) return
      pendingReplyRef.current = null
      // Only the exact prefill the unknown address produced is rewritten; an
      // edited To line means the user already took the list from here.
      setDraft((prev) => {
        if (!prev || prev.to !== pending.prefilledTo) return prev
        const targets = replyAllRecipients(pending.target, userEmail)
        return { ...prev, to: targets.to, cc: targets.cc }
      })
    }, [userEmail])

    // The prefill openers, hook-stable: `clear` is a stable callback and the
    // rest are state setters, so the handle below recreates only when the
    // thread, the latest message, or the account address changes.
    const openReplyComposer = useCallback(
      (target: EmailDetailData, toLine: string, ccLine = ''): void => {
        setSendError(null)
        setSent(false)
        // A fresh reply starts from a clean file set the way it starts from a
        // clean body: the hook instance survives the pane, so an abandoned
        // earlier reply's picked files must not ride into this one.
        clearAttachments()
        const originalText = target.bodyText || target.snippet || thread.snippet

        setQuotedContent({ html: quoteHtmlFor(target, originalText, false) })
        setComposerSeq((prev) => prev + 1)
        setDraft({
          to: toLine,
          // An empty carbon line stays unset: an absent field is the payload's
          // "no carbon recipients", never an empty header.
          ...(ccLine ? { cc: ccLine } : {}),
          subject: /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`,
          // The typed body starts empty; the quote markup lives in the editor's
          // own prefill (quotedContent above), not in the text state.
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
          // Same as the reply: empty typed body, the forwarded content lives in
          // the editor's prefill. The forward header inside the quote keeps the
          // same "---------- Forwarded message ---------" Gmail layout.
          body: '',
          // Keep the forward in the same Gmail thread so it shows up in the
          // conversation view alongside the original + replies.
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
          // A reply-all opened before the account address landed prefilters
          // nothing: when it arrives, an untouched To line gets one rewrite.
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
      // The Enter key submits the form even with the Send button disabled, so
      // the receipt test lives here, not only on the button.
      if (!draft || sending || !hasRecipient(draft)) return

      setSending(true)
      setSendError(null)
      setSent(false)
      try {
        await window.api.sendEmail({ ...draft, ...attach.field })
        setDraft(null)
        setQuotedContent(null)
        setSent(true)
        // Refresh the conversation so the just-sent reply/forward is visible.
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

            {/* Remounts per reply/forward open (composerSeq): the quote
              prefill is the only programmatic content, and typed content
              lives in the uncontrolled editor between opens. */}
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
