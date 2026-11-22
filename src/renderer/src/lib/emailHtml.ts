import DOMPurify from 'dompurify'

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

export const QUOTE_BLOCKQUOTE_STYLE =
  'margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex'

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
