import { computed, ref, watch } from 'vue'
import { checkProblems } from '../../lib/browser'

const REC = 'qa.browser.rec'
/** What the side panel shows: «Проверка», the recording, «Карта API», the hooks. */
export type PanelMode = 'rec' | 'hooks' | 'check' | 'map'

/** The side panel at the right: open or not and its width (remembered, dragged), its mode, «Проверка»'s news. */
export function useSidePanel() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(REC) ?? '{}') as { open?: boolean; w?: number }
    } catch {
      return {}
    }
  })()
  const recOpen = ref(saved.open ?? false)
  const recW = ref(saved.w ?? 420)
  watch([recOpen, recW], () => {
    try {
      localStorage.setItem(REC, JSON.stringify({ open: recOpen.value, w: recW.value }))
    } catch {
      // fine
    }
  })
  function dragRec(e: PointerEvent): void {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = recW.value
    const move = (ev: PointerEvent) => (recW.value = Math.min(900, Math.max(300, w0 - (ev.clientX - x0))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const panelMode = ref<PanelMode>('check')
  /** «Проверка»: the findings not taken into a bug yet — the button's number. */
  const checkNew = computed(() => checkProblems.value.filter((p) => !p.note).length)
  const checkHigh = computed(() => checkProblems.value.some((p) => !p.note && p.sev === 'high'))
  return { recOpen, recW, dragRec, panelMode, checkNew, checkHigh }
}
