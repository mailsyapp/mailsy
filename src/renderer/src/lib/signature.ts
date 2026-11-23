export const SIGNATURE_BLOCK_CLASS = 'mailsy-signature'

export const SIGNATURE_BLOCK_SELECTOR = `.${SIGNATURE_BLOCK_CLASS}`

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
    return
  }
}
