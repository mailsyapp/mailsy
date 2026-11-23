import type { ComposeAttachment } from '../../../shared/types'

export function looksLikeImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return looksLikeImageName(file.name)
}

export function looksLikeImageName(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(filename)
}

export function imageMimeOf(filename: string): string {
  const match = filename.match(/\.([a-z0-9]+)$/i)
  switch (match?.[1]?.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'svg':
      return 'image/svg+xml'
    case 'bmp':
      return 'image/bmp'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

async function fileBytes(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

export interface DroppedImage {
  mimeType: string
  name: string
  base64: string
}

export async function imageToPayload(file: File): Promise<DroppedImage | null> {
  if (!looksLikeImageFile(file)) return null
  return {
    mimeType: file.type || 'image/png',
    name: file.name,
    base64: await fileBytes(file)
  }
}

export async function fileToAttachment(file: File): Promise<ComposeAttachment | null> {
  if (looksLikeImageFile(file)) return null
  const data = await fileBytes(file)
  return { filename: file.name, size: file.size, data }
}

export function dragsFiles(event: { dataTransfer?: DataTransfer | null }): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}
