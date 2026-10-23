import { ref, watch } from 'vue'
import { parseTable, tableMd, type TableModel } from './model'

/**
 * The table's model kept in step with its text in the note: read again when the text changes from outside,
 * written back (a GFM table, its settings in a comment) a moment after an edit — or at once.
 */
export function useTableDoc(src: () => string, onChange: (md: string) => void) {
  const t = ref<TableModel>(parseTable(src()))
  /** The text last read or written (our own change coming back is not read again). */
  let mine = src()
  watch(src, (s) => {
    if (s === mine) return
    mine = s
    t.value = parseTable(s)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Written back: shortly (typing) or `now`. */
  function save(now = false): void {
    clearTimeout(timer)
    const go = () => {
      const md = tableMd(t.value)
      if (md === mine) return
      mine = md
      onChange(md)
    }
    if (now) go()
    else timer = setTimeout(go, 250)
  }
  return { t, save }
}
