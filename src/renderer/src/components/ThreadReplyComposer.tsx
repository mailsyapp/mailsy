import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type {
  EmailDetail as EmailDetailData,
  SendEmailRequest,
  ThreadSummary
} from '../../../shared/types'
import { quoteHtmlFor } from '../lib/emailHtml'
import { replyAllRecipients } from '../lib/recipients'
import { ThreadReplyForm } from './ThreadReplyForm'
import type { AttachmentPrefill } from './useComposerAttachments'

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
    const [attachmentPrefill, setAttachmentPrefill] = useState<AttachmentPrefill>()
    const [sent, setSent] = useState(false)

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

    const openReplyComposer = useCallback(
      (target: EmailDetailData, toLine: string, ccLine = ''): void => {
        setSent(false)
        setAttachmentPrefill(undefined)
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
      [thread.snippet]
    )

    const openForwardComposer = useCallback(
      (target: EmailDetailData): void => {
        setSent(false)
        setAttachmentPrefill(
          target.attachments.length ? { messageId: target.id, refs: target.attachments } : undefined
        )
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
      [thread.snippet]
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

    return (
      <>
        {draft && (
          <ThreadReplyForm
            key={composerSeq}
            draft={draft}
            prefill={attachmentPrefill}
            initialHtml={quotedContent?.html ?? ''}
            onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
            onCancel={() => {
              setDraft(null)
              setQuotedContent(null)
            }}
            onSent={() => {
              setDraft(null)
              setQuotedContent(null)
              setSent(true)
              onSent(latestMessage?.threadId ?? thread.id)
            }}
          />
        )}
        {sent && <p role="status">Message sent.</p>}
      </>
    )
  }
)
