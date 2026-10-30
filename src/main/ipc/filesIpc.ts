import { clipboard as sysClipboard, ClipboardItem, dialog, nativeImage, shell } from 'electron'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLE_FILE_METHODS } from '../../shared/tableData'
import type { AppContext } from '../app/appContext'
import { TableFiles } from '../tableFiles/tableFiles'
import { ValueFiles } from '../valueFiles'
import { VALUE_FILE_METHODS } from '../../shared/valueFiles'
import { handle, handleDispatch, listen } from './router'

/**
 * Files the person saves and keeps: the PDF signing's drawings (data/signatures, PNG), «save as» of a picture / a PDF
 * / any bytes, table files (rows as Excel / CSV, a table file read back), hashes, a picture into the clipboard, web
 * links opened in the system browser.
 */
export function registerFilesIpc(app: AppContext): void {
  const tableFiles = new TableFiles()
  handleDispatch('tableFile', TABLE_FILE_METHODS, () => tableFiles)
  // a note's value kept as a file each run («Сохранить в файл»)
  const valueFiles = new ValueFiles()
  handleDispatch('valueFile', VALUE_FILE_METHODS, () => valueFiles)
  /** A «save as» dialog over the main window: the path picked, or undefined. */
  const saveAs = async (opts: Electron.SaveDialogOptions): Promise<string | undefined> => {
    const main = app.windows.main
    const r = main ? await dialog.showSaveDialog(main, opts) : await dialog.showSaveDialog(opts)
    return r.canceled || !r.filePath ? undefined : r.filePath
  }
  /** Bytes written where the person says. */
  const saveBytes = async (bytes: Uint8Array, opts: Electron.SaveDialogOptions) => {
    const file = await saveAs(opts)
    if (file) writeFileSync(file, Buffer.from(bytes))
    return file
  }

  // ---------- PDF signing: the drawings ----------
  const sigDir = join(app.store.root, 'signatures')
  handle('sigList', () => {
    if (!existsSync(sigDir)) return []
    return readdirSync(sigDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ id: f.slice(0, -4), url: `data:image/png;base64,${readFileSync(join(sigDir, f)).toString('base64')}`, at: statSync(join(sigDir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .map(({ id, url }) => ({ id, url }))
  })
  handle('sigSave', (_e, url) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(url)
    if (!m) throw new Error('Не PNG')
    mkdirSync(sigDir, { recursive: true })
    const id = randomUUID()
    writeFileSync(join(sigDir, `${id}.png`), Buffer.from(m[1], 'base64'))
    return id
  })
  handle('sigDelete', (_e, id) => {
    if (/^[\w-]+$/.test(id)) rmSync(join(sigDir, `${id}.png`), { force: true })
  })

  // ---------- «save as» ----------
  handle('imageSave', (_e, bytes, name, ext) => {
    const e = ext === 'svg' ? 'svg' : 'png'
    return saveBytes(bytes, { defaultPath: name, filters: [{ name: e.toUpperCase(), extensions: [e] }] })
  })
  handle('fileSave', (_e, bytes, name, ext) => {
    const e = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin'
    return saveBytes(bytes, { defaultPath: name, filters: [{ name: e.toUpperCase(), extensions: [e] }, { name: 'Все файлы', extensions: ['*'] }] })
  })
  handle('pdfSave', (_e, bytes, name) => saveBytes(bytes, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] }))

  // ---------- hashes ----------
  handle('hashOf', async (_e, src, key) => {
    const algs = ['md5', 'sha1', 'sha256', 'sha512'] as const
    const hs = algs.map((a) => (key ? createHmac(a, key) : createHash(a)))
    if (typeof src?.path === 'string' && src.path) {
      // a file of any size: read in pieces
      for await (const chunk of createReadStream(src.path)) for (const h of hs) h.update(chunk as Buffer)
    } else {
      const data = src?.bytes ? Buffer.from(src.bytes) : Buffer.from(String(src?.text ?? ''), 'utf8')
      for (const h of hs) h.update(data)
    }
    return Object.fromEntries(algs.map((a, i) => [a, hs[i].digest('hex')])) as Record<(typeof algs)[number], string>
  })

  // ---------- the clipboard, links ----------
  handle('copyImage', async (_e, bytes) => {
    // (a JPEG too — the clipboard takes it as PNG)
    const img = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (img.isEmpty()) throw new Error('это не картинка')
    await sysClipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })])
  })
  listen('openExternal', (_e, url) => {
    // web pages only (Jira, links in notes) — never file:// or app protocols
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
}
