import { nextTick, ref, watch } from 'vue'
import type { VaultHit } from '@shared/vault'
import { docs, saveAll } from '@nb/workspace/noteDocs'
import { curPane, layout, openFile } from '@nb/workspace/paneLayout'
import type { NoteEditors } from './noteEditors'

/** Search through all notes (unsaved typing too): the query kept while the side shows the files, a hit opened at its line. */
export function useVaultSearch(editors: NoteEditors) {
  const q = ref('')
  const hits = ref<VaultHit[]>([])
  const searching = ref(false)
  /** The query field (set by the search panel). */
  let input: HTMLInputElement | null = null
  const setSearchInput = (el: unknown) => (input = (el as HTMLInputElement | null) ?? null)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(q, (v) => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      searching.value = true
      // unsaved typing is searched too
      await saveAll()
      hits.value = await window.qa.vaultSearch(v)
      searching.value = false
    }, 160)
  })
  /** The side shows the search (its field focused, its text chosen) or the files. */
  async function toggleSearch(on = layout.sideTab !== 'search'): Promise<void> {
    layout.sideTab = on ? 'search' : 'files'
    if (on) {
      await nextTick()
      input?.focus()
      input?.select()
    }
  }
  /** A hit opened — at its line once the editor is there (the note may still be loading). */
  async function openHit(h: VaultHit, line?: VaultHit['lines'][number]): Promise<void> {
    openFile(h.path)
    const p = curPane()
    if (!line) return
    for (let i = 0; i < 40; i++) {
      await nextTick()
      const ed = editors.of(p)
      if (ed && docs.get(h.path)?.loaded) {
        ed.reveal(line.line, line.col, line.len)
        return
      }
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  return { q, hits, searching, setSearchInput, toggleSearch, openHit }
}
