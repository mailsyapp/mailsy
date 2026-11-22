export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function senderNameOf(from: string): string {
  return from.match(/^(.*?)\s*<[^>]+>$/)?.[1].replace(/^"|"$/g, '') ?? from
}
