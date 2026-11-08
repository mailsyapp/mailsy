// Display helpers shared between the list rows, the composer's chips, and
// the read-view attachment row. Kept out of component files so fast
// refresh stays valid.

// Reads as bytes under 1 KB, kilobytes under 1 MB, one decimal for MB.
// Gmail's ref sizes report the raw base64 payload, so these are close
// enough at chip scale and never claimed to be exact.
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// One unknown-catch shape for every bridge call's `.catch`: the Error
// keeps its message; anything else stringifies.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// "Ada Lovelace <ada@example.com>" renders as "Ada Lovelace"; the address
// stays for unparseable or bare sender strings.
export function senderNameOf(from: string): string {
  return from.match(/^(.*?)\s*<[^>]+>$/)?.[1].replace(/^"|"$/g, '') ?? from
}
