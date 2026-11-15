import { plainTextToHtml } from './emailHtml'

// The per-compose signature. The stored signature is one account-level
// text the user edits from any composer; the per-message state lives in
// the body itself — inserting appends a marked block to the rich content,
// removing takes it back out, and a send/draft autosave carries it as
// ordinary body html with no extra payload field.
//
// Storage is renderer-local (localStorage): the signature is a composing
// convenience, not account data the boundary knows about, so it needs no
// bridge verb and no mock. A denied or missing storage keeps the session
// usable with an empty signature.

// Marks the signature block inside the body html: the same class the
// editor's insert/remove/presence checks speak, and what a stored draft's
// round trip preserves (drafts.update replaces the raw message wholesale,
// so the marked block rides the body like any other content).
export const SIGNATURE_BLOCK_CLASS = 'mailsy-signature'

export const SIGNATURE_BLOCK_SELECTOR = `.${SIGNATURE_BLOCK_CLASS}`

// The stored signature text, as the user typed it (plain text with
// newlines; rendering turns each line break into <br>).
export function loadSignature(): string {
  try {
    return window.localStorage.getItem('mailsy.signature') ?? ''
  } catch {
    return ''
  }
}

export function saveSignature(text: string): void {
  try {
    window.localStorage.setItem('mailsy.signature', text)
  } catch {
    // Unwritable storage (private mode, quota): the edit still applies to
    // this compose via the editor; only its persistence is lost.
  }
}

// The block's inner markup: the plain text escaped and line-broken the
// same way every plain-text-to-body conversion in the app renders.
export function signatureHtml(text: string): string {
  return plainTextToHtml(text)
}
