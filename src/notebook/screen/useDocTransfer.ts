import type { Ref } from 'vue'
import { remoteError } from '../../shared/remoteError'
import { flushRuns } from '@nb/engine'
import { saveAll } from '@nb/workspace/noteDocs'
import { layout, openFile } from '@nb/workspace/paneLayout'
import { loadTree } from '@nb/workspace/vaultTreeStore'
import { dirOf, noteName } from '@nb/domain/notePaths'

/** A document (or a folder) into one file (.qvdoc) and back: exported, imported by a dialog or dropped from Explorer. */
export function useDocTransfer(say: (t: string) => void, folder: Ref<string | undefined>) {
  async function exportDoc(path: string): Promise<void> {
    try {
      await saveAll()
      await flushRuns()
      const r = await window.qa.docExport(path)
      if (!r) return
      const more = r.docs > 1 ? ` + ${r.docs - 1} связ.` : ''
      say(`Экспортировано: ${r.file.split(/[\\/]/).pop()}${more}${r.files ? `, файлов: ${r.files}` : ''}${r.missing.length ? ` · не найдено: ${r.missing.length}` : ''}`)
    } catch (e) {
      say(`Не удалось экспортировать: ${remoteError(e)}`)
    }
  }
  /** What came in: a folder — opened in the tree; a document — opened. */
  async function imported(r: { main: string; paths: string[]; folder?: string }): Promise<void> {
    await loadTree()
    if (r.folder) {
      const open = new Set(layout.open)
      for (let p = r.folder; p; p = dirOf(p)) open.add(p)
      layout.open = [...open]
      folder.value = r.folder
      say(`Папка «${noteName(r.folder)}» импортирована · документов: ${r.paths.length}`)
    } else {
      openFile(r.main)
      say(r.paths.length > 1 ? `Импортировано документов: ${r.paths.length}` : 'Документ импортирован')
    }
  }
  async function importDoc(dir: string): Promise<void> {
    try {
      const r = await window.qa.docImport(dir)
      if (r) await imported(r)
    } catch (e) {
      say(`Не удалось импортировать: ${remoteError(e)}`)
    }
  }
  /** .qvdoc files dragged from Explorer onto the tree: into the folder under them (or the top). */
  async function importDropped(e: DragEvent, dir: string): Promise<void> {
    const list = [...(e.dataTransfer?.files ?? [])]
    const docs = list.filter((x) => x.name.toLowerCase().endsWith('.qvdoc'))
    if (!docs.length) return void (list.length && say('Импортируются только файлы .qvdoc (экспорт документа или папки)'))
    for (const x of docs) {
      try {
        await imported(await window.qa.docImportFile(dir, window.qa.pathForFile(x)))
      } catch (err) {
        say(`«${x.name}» не импортирован: ${remoteError(err)}`)
      }
    }
  }
  return { exportDoc, importDoc, importDropped }
}
