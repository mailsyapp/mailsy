import { useReaction } from '../hooks/useReaction'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import type {
  EmailDetail as EmailDetailData,
  SendEmailRequest,
  ThreadSummary
} from '../../../shared/types'
import { quoteHtmlFor } from '../lib/emailHtml'
import { replyAllRecipients } from '../lib/recipients'
import { ThreadReplyForm } from './ThreadReplyForm'
import type { AttachmentPrefill } from './useComposerAttachments'

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
    const [attachmentPrefill, setAttachmentPrefill] = useState<AttachmentPrefill>()
    const [sent, setSent] = useState(false)

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
        setSent(false)
        setAttachmentPrefill(undefined)
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
          body: '',
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
