import { nextTick, ref, watch } from 'vue'
import type { VaultHit } from '@shared/vault'
import { saveAll } from '@nb/workspace/noteDocs'
import { askPlace } from '@nb/workspace/noteGoto'
import { layout, openFile } from '@nb/workspace/paneLayout'

/** Search through all notes (unsaved typing too): the query kept while the side shows the files, a hit opened at its line. */
export function useVaultSearch() {
  const q = ref('')
  const hits = ref<VaultHit[]>([])
  const searching = ref(false)
  /** The query field (set by the search panel). */
  let input: HTMLInputElement | null = null
  const setSearchInput = (el: unknown) => (input = (el as HTMLInputElement | null) ?? null)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The last search asked: a slower answer to an older query never replaces a newer one. */
  let asked = 0
  watch(q, (v) => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const mine = ++asked
      searching.value = true
      try {
        // unsaved typing is searched too
        await saveAll()
        const found = await window.qa.vaultSearch(v)
        if (mine === asked) hits.value = found
      } finally {
        if (mine === asked) searching.value = false
      }
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
  /** A hit opened at its line: the note's editor shows it once its text is in (the note may still be loading). */
  function openHit(h: VaultHit, line?: VaultHit['lines'][number]): void {
    askPlace(h.path, line && { line: line.line, col: line.col, len: line.len })
    openFile(h.path)
  }
  return { q, hits, searching, setSearchInput, toggleSearch, openHit }
}
