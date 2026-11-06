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

export function buildQuoteHtml(
  attrHtml: string,
  originalHtml: string,
  originalText: string
): string {
  const inner = originalHtml || plainTextToHtml(originalText)
  return `<div class="gmail_quote gmail_quote_container"><div class="gmail_attr">${attrHtml}</div><blockquote class="gmail_quote" style="${QUOTE_BLOCKQUOTE_STYLE}">${inner}</blockquote></div>`
}
