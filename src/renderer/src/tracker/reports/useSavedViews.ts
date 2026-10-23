import { ref, watch, type Ref } from 'vue'
import type { ReportFilter } from '@shared/report'
import { readJson, todayDay, writeJson, type ReportState } from './useReportsState'

/** A report view saved under a name (a picked range keeps its dates, a unit period follows today). */
export interface SavedView {
  name: string
  state: Omit<ReportState, 'anchor' | 'from' | 'to'> & { from?: string; to?: string }
}
const SAVED_KEY = 'qa.reports.saved'
const copyFilter = (f: ReportFilter) => JSON.parse(JSON.stringify(f)) as ReportFilter

/** Saved report views and whether their list (a popover by its button) is open. */
export function useSavedViews(st: Ref<ReportState>) {
  const saved = ref<SavedView[]>(readJson<SavedView[]>(SAVED_KEY, []))
  watch(saved, (v) => writeJson(SAVED_KEY, v), { deep: true })
  const open = ref(false)
  const newName = ref('')

  /** The current view under the typed name (replaces one with the same name). */
  function saveView(): void {
    const name = newName.value.trim()
    if (!name) return
    const s = st.value
    const state = { period: s.period, filter: copyFilter(s.filter), group: s.group, color: s.color, onlyProd: !!s.onlyProd, ...(s.period === 'custom' ? { from: s.from, to: s.to } : {}) }
    saved.value = [...saved.value.filter((x) => x.name !== name), { name, state }]
    newName.value = ''
  }
  function applyView(v: SavedView): void {
    st.value = { ...st.value, ...v.state, filter: copyFilter(v.state.filter), anchor: todayDay() }
    open.value = false
  }

  return { saved, open, newName, saveView, applyView }
}
