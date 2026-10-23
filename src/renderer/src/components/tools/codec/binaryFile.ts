import { sniffMime } from '@shared/codec'

/** A file (not a text) in the Base64 tab: its bytes, type, extension, name; a picture — its object URL and size. */
export interface Bin {
  bytes: Uint8Array
  mime: string
  ext: string
  name: string
  image: boolean
  url?: string
  w?: number
  h?: number
}

/** The largest file taken (bigger Base64 is no use in a text). */
export const MAX_FILE = 25 * 1024 * 1024

/** What some bytes are: the type sniffed from them, else the hint, else binary; a name for saving. */
export function describeBytes(bytes: Uint8Array, name?: string, mimeHint?: string): Omit<Bin, 'url' | 'w' | 'h'> {
  const s = sniffMime(bytes)
  const mime = s?.mime ?? mimeHint ?? 'application/octet-stream'
  const ext = s?.ext ?? (mimeHint?.split('/')[1]?.replace(/\W.*$/, '') || 'bin')
  return { bytes, mime, ext, name: name ?? `файл.${ext}`, image: !!s?.image || mime.startsWith('image/') }
}

/** A picture as PNG (what every program takes from the clipboard). */
export async function pngBlobOf(b: Bin): Promise<Blob> {
  const blob = new Blob([b.bytes as BlobPart], { type: b.mime })
  if (b.mime === 'image/png' || !b.url) return blob
  const img = new Image()
  img.src = b.url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  return new Promise<Blob>((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('png'))), 'image/png'))
}
