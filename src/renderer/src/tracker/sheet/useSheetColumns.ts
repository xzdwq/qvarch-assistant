import { computed, ref, type Ref } from 'vue'
import { readStored, writeStored } from './sheetStorage'

/** Column widths, px: the row label, a day, the total. */
export type SheetColWidths = { rl: number; dc: number; tc: number }

/** The narrowest a column may get (the row label needs more room). */
const MIN_W: SheetColWidths = { rl: 110, dc: 44, tc: 44 }
const MAX_W = 700

/** The sheet's column widths: dragged by their edge, remembered under `suffix` (the dashboard's apart). */
export function useSheetColumns(suffix: string, widget: boolean | undefined, cols: Ref<string[]>) {
  const COLS_KEY = `qa.sheet.cols${suffix}`
  const defaults: SheetColWidths = { rl: widget ? 190 : 300, dc: 76, tc: 76 }
  const colW = ref<SheetColWidths>({ ...defaults, ...readStored<Partial<SheetColWidths>>(COLS_KEY, {}) })
  const tableW = computed(() => colW.value.rl + cols.value.length * colW.value.dc + (cols.value.length > 1 ? colW.value.tc : 0))

  /** A column edge pressed: the width follows the pointer until release, then is remembered. */
  function startColResize(e: PointerEvent, key: keyof SheetColWidths): void {
    const x0 = e.clientX
    const w0 = colW.value[key]
    const move = (ev: PointerEvent) => (colW.value = { ...colW.value, [key]: Math.max(MIN_W[key], Math.min(MAX_W, Math.round(w0 + ev.clientX - x0))) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      writeStored(COLS_KEY, colW.value)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  return { colW, tableW, startColResize }
}
