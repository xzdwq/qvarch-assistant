import { computed, ref } from 'vue'
import { presetId, WATCH_COLOR_VARS, type TermWatch } from '@shared/terminal'
import { cssHex } from '../../lib/cssColor'
import { upsertById, watchEditError, watchTestMatch } from '@shared/terminalEdit'
import type { TermConfigState } from './useTermConfig'

/** The reaction dialog (with a test line to try it on), switching reactions on and off, removing them. */
export function useWatchEditor({ cfg, saveCfg }: TermConfigState) {
  const wEdit = ref<TermWatch>()
  const wNew = ref(false)
  const wTest = ref('')
  const wErr = computed(() => (wEdit.value ? watchEditError(wEdit.value) : ''))
  /** The test line against the reaction being edited: what it would catch (undefined — nothing to try yet). */
  const wTestHit = computed(() => (!wEdit.value || !wTest.value || wErr.value ? undefined : watchTestMatch(wEdit.value, wTest.value)))
  const saveWatches = () => saveCfg({ watches: cfg.value.watches })

  function addWatch(): void {
    const color = cssHex(WATCH_COLOR_VARS[cfg.value.watches.length % WATCH_COLOR_VARS.length]) ?? ''
    wEdit.value = { id: presetId(), name: '', patterns: '', ignoreCase: true, word: false, color, on: true }
    wNew.value = true
    wTest.value = ''
  }
  function editWatch(w: TermWatch): void {
    wEdit.value = { ...w }
    wNew.value = false
    wTest.value = ''
  }
  /** Kept (a reaction without a name is named by its first pattern). */
  function saveWatch(): void {
    const w = wEdit.value
    if (!w || wErr.value) return
    if (!w.name.trim()) w.name = w.patterns.split('\n')[0].trim().slice(0, 30)
    upsertById(cfg.value.watches, w)
    wEdit.value = undefined
    saveWatches()
  }
  function toggleWatch(w: TermWatch, on: boolean): void {
    w.on = on
    saveWatches()
  }
  function removeWatch(w: TermWatch): void {
    if (!confirm(`Удалить реакцию «${w.name}»?`)) return
    cfg.value.watches = cfg.value.watches.filter((x) => x.id !== w.id)
    saveWatches()
  }
  return { wEdit, wNew, wTest, wErr, wTestHit, addWatch, editWatch, saveWatch, toggleWatch, removeWatch }
}
