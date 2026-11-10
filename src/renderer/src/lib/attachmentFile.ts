import type { ComposeAttachment } from '../../../shared/types'

// File-entry helpers shared by the composer's two entrances into its
// content: the attachment hook (files as chips) and the body editor
// (image files inline in the rich body). One module so the image routing
// rule cannot drift between the entry points.

// Image routing: a dropped or pasted file with an image MIME type (or, for
// the case where the OS had no type to give, an image-shaped extension)
// belongs in the rich body; everything else stays an attachment chip. The
// read view previews by the same filename rule.
export function looksLikeImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return looksLikeImageName(file.name)
}

export function looksLikeImageName(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(filename)
}

// The data URL's media type from the same filename. `jpg` maps to its
// registered jpeg sibling — `image/jpg` is not a real type and previews
// would refuse it — and svg keeps its plus sign.
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

// A dropped File carries its own bytes; renderers have no Buffer, so the
// chunked btoa walk is the standard-browser equivalent of main's
// fs.readFile + toString('base64'). Chunks stay under the argument-size
// that makes String.fromCharCode overflow.
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

// The editor's record of a dropped image: bytes plus the type it declares,
// enough to build the data URL that rides the body HTML.
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

// Only file drags count: text and url drags (a selection dragged between
// fields, a dragged link) must behave as they always did.
export function dragsFiles(event: { dataTransfer?: DataTransfer | null }): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}
