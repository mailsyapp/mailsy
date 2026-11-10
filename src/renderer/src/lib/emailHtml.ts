import DOMPurify from 'dompurify'

// HTML helpers shared between the body editor, the composers, and the
// conversation view. Kept out of component files so fast refresh stays
// valid and all three surfaces sanitize with one implementation.

export function escapeHtml(value: string): string {
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

export function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

export function sanitizeEmailHtml(html: string): string {
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
export const QUOTE_BLOCKQUOTE_STYLE =
  'margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex'

// Message-detail's date exactly as Gmail renders it inside the reply
// attribution ("On Fri, Nov 7, 2025 at 10:15 AM wrote:"). An unparsable
// date stays literal rather than lying with a placeholder.
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

// The reply/forward quote for the rich body: the attribution or forward
// header inside Gmail's native quote markup, followed by the original
// content (html sanitized as it is for the read view, plaintext escaped).
// The empty typed body starts ahead of the `<br><br>` seam.
export function quoteHtmlFor(
  target: { from: string; to: string; date: string; subject: string; bodyHtml?: string },
  originalText: string,
  isForward: boolean
): string {
  const forwardHeader = [
    '---------- Forwarded message ---------',
    `From: ${target.from}`,
    `To: ${target.to}`,
    `Date: ${target.date}`,
    `Subject: ${target.subject}`
  ]
    .map(escapeHtml)
    .join('<br>')
  const attrHtml = isForward
    ? forwardHeader.concat('<br><br>')
    : `On ${escapeHtml(gmailDateOf(target.date))}, ${escapeHtml(target.from)} wrote:<br>`
  return `<br><br>${buildQuoteHtml(attrHtml, target.bodyHtml ? sanitizeEmailHtml(target.bodyHtml) : '', originalText)}`
}

export function buildQuoteHtml(
  attrHtml: string,
  originalHtml: string,
  originalText: string
): string {
  const inner = originalHtml || plainTextToHtml(originalText)
  return `<div class="gmail_quote gmail_quote_container"><div class="gmail_attr">${attrHtml}</div><blockquote class="gmail_quote" style="${QUOTE_BLOCKQUOTE_STYLE}">${inner}</blockquote></div>`
}
