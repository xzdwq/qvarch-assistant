import type { Ref } from 'vue'
import type { TableModel } from './model'

/**
 * A column's width: its right edge dragged (the first drag fixes every column at its width now — the others must
 * not jump), a double click — back to «by the content».
 */
export function useColumnWidths(t: Ref<TableModel>, save: (now?: boolean) => void, tableEl: Ref<HTMLTableElement | undefined>) {
  const fixed = () => !!t.value.widths?.some((w) => w > 0)
  const headWidths = () => ([...(tableEl.value?.querySelectorAll('thead th') ?? [])] as HTMLElement[]).map((th) => Math.round(th.getBoundingClientRect().width))
  function dragWidth(c: number, e: PointerEvent): void {
    e.preventDefault()
    if (!fixed()) t.value.widths = headWidths()
    const w0 = t.value.widths![c]
    const x0 = e.clientX
    const move = (ev: PointerEvent) => {
      t.value.widths![c] = Math.max(60, Math.min(900, Math.round(w0 + ev.clientX - x0)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      save(true)
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function autoWidth(c: number): void {
    if (!t.value.widths) return
    t.value.widths[c] = 0
    if (!t.value.widths.some((w) => w > 0)) t.value.widths = undefined
    else {
      // a column «by the content» in a fixed table: as wide as it is now
      const th = tableEl.value?.querySelectorAll('thead th')[c] as HTMLElement | undefined
      t.value.widths[c] = th ? Math.round(th.getBoundingClientRect().width) : 160
    }
    save(true)
  }
  const colStyle = (c: number) => (fixed() ? { width: `${t.value.widths![c] || 160}px` } : {})
  return { fixed, dragWidth, autoWidth, colStyle }
}
