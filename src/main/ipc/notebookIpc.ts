import { app as electronApp, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUNDLE_EXT, MAX_BUNDLE, parseBundle } from '../../shared/docBundle'
import { toVaultEntryKind } from '../../shared/vault'
import type { AppContext } from '../app/appContext'
import { TraceServer } from '../traceServer'
import { handle, listen } from './router'

/**
 * The notebook's files: the notes and folders (the vault), their recordings and pictures, the runs' results and
 * files (traces, screenshots, Allure), a document packed into one file and back.
 */
export function registerNotebookIpc(app: AppContext): void {
  const { vault, store, voice } = app
  const str = (v: unknown) => String(v ?? '')

  // ---------- notes and folders ----------
  handle('vaultTree', () => vault.tree())
  handle('vaultRead', (_e, p) => vault.read(str(p)))
  handle('vaultWrite', (_e, p, text) => vault.write(str(p), str(text)))
  handle('vaultCreate', (_e, dir, kind, name, text) => vault.create(str(dir), toVaultEntryKind(kind), name ? str(name) : undefined, text ? str(text) : ''))
  handle('vaultMove', (_e, from, toDir, name) => vault.move(str(from), str(toDir), name === undefined ? undefined : str(name)))
  handle('vaultDelete', (_e, p) => vault.remove(str(p)))
  handle('vaultSearch', (_e, q) => vault.search(str(q)))
  handle('eventMentions', () => vault.eventMentions())
  listen('vaultReveal', (_e, p) => vault.reveal(str(p)))
  handle('vaultPair', (_e, a, b) => vault.setPair(str(a), typeof b === 'string' && b ? str(b) : undefined))
  // an emoji mark: one emoji (a few code points), no text
  handle('vaultSetEmoji', (_e, p, emoji) => vault.setEmoji(str(p), typeof emoji === 'string' && emoji && emoji.length <= 16 && /\p{Extended_Pictographic}/u.test(emoji) ? emoji : undefined))
  handle('vaultSetColor', (_e, p, color) => vault.setColor(str(p), typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined))

  // ---------- recordings and pictures ----------
  handle('vaultSaveAudio', (_e, audio) => vault.saveAudio(audio))
  handle('vaultReadAudio', (_e, p) => vault.readAudio(str(p)))
  handle('vaultDeleteAudio', (_e, p) => vault.deleteAudio(str(p)))
  handle('vaultRestoreAudio', (_e, p, audio) => vault.restoreAudio(str(p), audio))
  handle('vaultTranscribe', (_e, wav, key) => {
    if (!store.cfg.voice.enabled) throw new Error('Расшифровка выключена в настройках')
    return voice.transcribe(`vault-${typeof key === 'string' && key ? key : randomUUID()}`, wav)
  })
  // the recording deleted: its whisper stopped (or taken out of the queue)
  listen('vaultTranscribeCancel', (_e, key) => typeof key === 'string' && key && voice.cancel(`vault-${key}`))
  handle('vaultSaveImage', (_e, bytes) => vault.saveImage(bytes))
  handle('vaultReadImage', (_e, p) => vault.readImage(str(p)))
  handle('vaultDeleteImage', (_e, p) => vault.deleteImage(str(p)))
  handle('vaultRestoreImage', (_e, p, bytes) => vault.restoreImage(str(p), bytes))
  handle('vaultClipImage', (_e, save) => vault.clipImage(!!save))
  handle('vaultFetchImage', (_e, url) => vault.fetchImage(str(url)))

  // ---------- the runs: results, a block's files ----------
  handle('runLoad', (_e, p) => vault.runRead(str(p)))
  handle('runSave', (_e, p, json) => vault.runWrite(str(p), str(json)))
  handle('runFile', (_e, p, key, name) => {
    const n = str(name)
    if (!/^(final|failure)\.png$|^layout-\d+x\d+-\d+\.png$/.test(n)) throw new Error('Недопустимый файл')
    return readFileSync(join(vault.runDir(str(p), str(key)), n))
  })
  const traces = new TraceServer(vault.runsRoot)
  electronApp.on('will-quit', () => traces.stop())
  handle('pwTrace', async (_e, p, key) => {
    const url = await traces.url(join(vault.runDir(str(p), str(key)), 'trace.zip'))
    app.browser?.open(url)
    app.windows.showMain({ view: 'browser' })
  })
  listen('pwAllure', (_e, p, key) => {
    const dir = join(vault.runDir(str(p), str(key)), 'allure-results')
    if (existsSync(dir)) void shell.openPath(dir)
  })

  // ---------- a document into one file — and back (on another machine) ----------
  const main = () => app.windows.main
  handle('docExport', async (_e, p) => {
    const rel = str(p)
    let withRuns = false
    if (vault.hasRuns(rel)) {
      const opts = {
        type: 'question' as const,
        title: 'Экспорт документа',
        message: 'Включить результаты выполнения?',
        detail: 'Контекст заметки и ответы HTTP-блоков. В них могут быть токены, пароли и личные данные — включайте, только если файл не уйдёт посторонним.',
        buttons: ['Без результатов', 'С результатами', 'Отмена'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
      const w = main()
      const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
      if (r.response === 2) return undefined
      withRuns = r.response === 1
    }
    const { bundle, missing } = vault.exportDoc(rel, withRuns, electronApp.getVersion())
    const name = (rel.replace(/\/+$/, '').split('/').pop() || 'Документ').replace(/\.(md|qboard)$/i, '')
    const opts = { defaultPath: `${name}.${BUNDLE_EXT}`, filters: [{ name: 'Документ Qvarch', extensions: [BUNDLE_EXT] }] }
    const w = main()
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return undefined
    writeFileSync(r.filePath, JSON.stringify(bundle))
    return { file: r.filePath, docs: bundle.docs.length, files: Object.keys(bundle.files).length, missing }
  })
  handle('docImport', async (_e, dir) => {
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Документ Qvarch', extensions: [BUNDLE_EXT] }, { name: 'Все файлы', extensions: ['*'] }] }
    const w = main()
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return undefined
    return importBundleFile(app, r.filePaths[0], str(dir))
  })
  // a .qvdoc dropped on the notebook's side
  handle('docImportFile', (_e, dir, file) => {
    const p = str(file)
    if (!p.toLowerCase().endsWith(`.${BUNDLE_EXT}`)) throw new Error('Это не документ Qvarch (.qvdoc)')
    return importBundleFile(app, p, str(dir))
  })
}
/** A .qvdoc file (not too big) unpacked into a folder of the vault. */
function importBundleFile(app: AppContext, file: string, dir: string) {
  if (statSync(file).size > MAX_BUNDLE) throw new Error(`Файл больше ${MAX_BUNDLE / 1024 / 1024} МБ`)
  return app.vault.importDoc(parseBundle(readFileSync(file, 'utf8')), dir)
}
