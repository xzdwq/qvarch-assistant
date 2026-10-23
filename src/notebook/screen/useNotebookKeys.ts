import { onBeforeUnmount, onMounted } from 'vue'
import { closeTab, curPane, layout, toggleSplit } from '@nb/workspace/paneLayout'

/** One shortcut of the notes screen (with Ctrl / ⌘): when it applies and what it does. */
interface Shortcut {
  when: (key: string, e: KeyboardEvent) => boolean
  run: (e: KeyboardEvent) => void
}

/** The notes screen's shortcuts: Ctrl+N — a new note, Ctrl+Shift+F — search, Ctrl+W — close, Ctrl+\ — split, Ctrl+Tab — next tab. */
export function useNotebookKeys(actions: { newNote: () => unknown; openSearch: () => unknown }) {
  const shortcuts: Shortcut[] = [
    { when: (k, e) => k === 'n' && !e.shiftKey, run: () => void actions.newNote() },
    { when: (k, e) => k === 'f' && e.shiftKey, run: () => void actions.openSearch() },
    {
      when: (k) => k === 'w',
      run: () => {
        const p = curPane()
        if (p?.active) closeTab(layout.cur, p.active)
      },
    },
    { when: (_k, e) => e.key === '\\', run: () => toggleSplit() },
    {
      when: (_k, e) => e.key === 'Tab',
      run: (e) => {
        const p = curPane()
        const i = p.tabs.findIndex((t) => t.path === p.active)
        if (p.tabs.length) p.active = p.tabs[(i + (e.shiftKey ? -1 : 1) + p.tabs.length) % p.tabs.length].path
      },
    },
  ]
  function onKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    const s = shortcuts.find((x) => x.when(k, e))
    if (!s) return
    e.preventDefault()
    s.run(e)
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
