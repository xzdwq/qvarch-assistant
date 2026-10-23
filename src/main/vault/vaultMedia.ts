import { clipboard, net } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { IMAGE_REL } from '../../shared/vault'
import type { VaultFiles } from './vaultFiles'

/** A voice recording of a note: vault/.audio/<file>.webm. */
export const AUDIO_REL = /^\.audio\/[\w.-]+\.webm$/
const MAX_IMAGE = 30 * 1024 * 1024

/** A picture's type by its first bytes. */
export function imageType(b: Uint8Array): string | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  if (at(0, 0x42, 0x4d)) return 'bmp'
  return undefined
}

/** A dated, unique name under a media folder: `.audio/2026-10-19-1a2b3c4d.webm`. */
const mediaName = (folder: string, ext: string) => `${folder}/${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`

/**
 * The notes' media: voice recordings (vault/.audio) and pictures of the notes and the boards (vault/.images).
 * A file is deleted only when no note / board has it any more (`usedBy`); an undo puts it back.
 */
export class VaultMedia {
  constructor(
    private files: VaultFiles,
    /** Some note or board has this text. */
    private usedBy: (needle: string) => boolean,
  ) {}

  private writeNew(rel: string, bytes: Uint8Array): void {
    const file = this.files.abs(rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  private checked(rel: string, valid: RegExp): string {
    if (!valid.test(rel)) throw new Error('Недопустимый путь')
    return this.files.abs(rel)
  }
  /** Deletes a file — unless something still has `needle`. Returns whether it was deleted. */
  private deleteUnused(file: string, needle: string): boolean {
    if (!existsSync(file)) return false
    if (this.usedBy(needle)) return false
    rmSync(file, { force: true })
    return true
  }
  /** Puts a file back (an undo brought it back after it was deleted); one already there stays. */
  private restore(file: string, bytes: Uint8Array): void {
    if (existsSync(file)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }

  // ---------- audio ----------
  saveAudio(bytes: Uint8Array): string {
    const rel = mediaName('.audio', 'webm')
    this.writeNew(rel, bytes)
    return rel
  }
  readAudio(rel: string): Uint8Array {
    return readFileSync(this.checked(rel, AUDIO_REL))
  }
  /** Deletes a recording from the disk — unless some note still embeds it. Returns whether it was deleted. */
  deleteAudio(rel: string): boolean {
    return this.deleteUnused(this.checked(rel, AUDIO_REL), `![[${rel}]]`)
  }
  /** Puts a recording back (an undo brought its line back after it was deleted). */
  restoreAudio(rel: string, bytes: Uint8Array): void {
    this.restore(this.checked(rel, AUDIO_REL), bytes)
  }

  // ---------- pictures ----------
  /** A picture's bytes → vault/.images (its type by the bytes, not by a name). */
  saveImage(bytes: Uint8Array): string {
    if (bytes.byteLength > MAX_IMAGE) throw new Error(`Изображение больше ${MAX_IMAGE / 1024 / 1024} МБ`)
    const ext = imageType(bytes)
    if (!ext) throw new Error('Это не изображение (поддерживаются PNG, JPEG, GIF, WebP, BMP)')
    const rel = mediaName('.images', ext)
    this.writeNew(rel, bytes)
    return rel
  }
  readImage(rel: string): Uint8Array {
    return readFileSync(this.checked(rel, IMAGE_REL))
  }
  /** Deletes a picture from the disk — unless some note or board still has it. Returns whether it was deleted. */
  deleteImage(rel: string): boolean {
    return this.deleteUnused(this.checked(rel, IMAGE_REL), rel)
  }
  /** Puts a picture back (an undo brought it back after it was deleted). */
  restoreImage(rel: string, bytes: Uint8Array): void {
    this.restore(this.checked(rel, IMAGE_REL), bytes)
  }
  /**
   * The picture on the clipboard: its signature ('' — none) and, when asked, saved to the vault.
   * (The signature tells a picture copied after the board's own Ctrl+C from the one that was there before.)
   */
  async clipImage(save: boolean): Promise<{ sig: string; rel?: string }> {
    if (!(await clipboard.has('image/png'))) return { sig: '' }
    const item = (await clipboard.read()).find((i) => i.types.includes('image/png'))
    const blob = item ? await item.getType('image/png').catch(() => undefined) : undefined
    if (!(blob instanceof Blob)) return { sig: '' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!bytes.byteLength) return { sig: '' }
    const sig = createHash('sha1').update(bytes).digest('hex').slice(0, 16)
    return save ? { sig, rel: this.saveImage(bytes) } : { sig }
  }
  /** A picture dragged from a web page (its address): downloaded into the vault. */
  async fetchImage(url: string): Promise<string> {
    if (url.startsWith('data:image/')) {
      const m = /^data:image\/[\w.+-]+;base64,(.*)$/s.exec(url)
      if (!m) throw new Error('Не удалось прочитать изображение')
      return this.saveImage(Buffer.from(m[1], 'base64'))
    }
    if (!/^https?:\/\//i.test(url)) throw new Error('Можно взять изображение только по ссылке http(s)')
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 20_000)
    try {
      const r = await net.fetch(url, { signal: ctl.signal })
      if (!r.ok) throw new Error(`Сайт ответил ${r.status}`)
      const len = Number(r.headers.get('content-length') ?? 0)
      if (len > MAX_IMAGE) throw new Error(`Изображение больше ${MAX_IMAGE / 1024 / 1024} МБ`)
      return this.saveImage(new Uint8Array(await r.arrayBuffer()))
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'Изображение не загрузилось за 20 секунд' : e instanceof Error ? e.message : String(e))
    } finally {
      clearTimeout(t)
    }
  }
}
