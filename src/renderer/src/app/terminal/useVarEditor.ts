import { computed, ref, watch, type Ref } from 'vue'
import { BUILTIN_VARS, presetId, type TermVar } from '@shared/terminal'
import { insertOf, upsertById, varNameError } from '@shared/terminalEdit'
import { remoteError } from '../../../../shared/remoteError'
import type { TermConfigState } from './useTermConfig'
import type { TermShells } from './useTermShells'
import type { SideTab } from './useTermViewPrefs'

/** The names a variable of one's own would hide (the built-in ones and the helpers). */
export const BUILTIN_NAMES = [...BUILTIN_VARS.map((b) => b.name), 'ask', 'sh']

/**
 * The variables: their values for the shell in front (its folder, its branch — asked again while the tab is open
 * and the shell changes), the variable dialog, copying a variable's insert.
 */
export function useVarEditor({ cfg, saveCfg }: TermConfigState, shells: TermShells, sideTab: Ref<SideTab>, runError: Ref<string>) {
  const values = ref<Record<string, { value?: string; error?: string }>>({})
  async function loadValues(): Promise<void> {
    try {
      values.value = await window.qa.termValues(shells.curId.value)
    } catch (e) {
      values.value = {}
      runError.value = remoteError(e)
    }
  }
  // their values for the shell in front (its folder, its branch)
  watch(
    () => [sideTab.value, shells.curId.value, shells.byId(shells.curId.value)?.info.cwd, shells.byId(shells.curId.value)?.info.branch],
    () => sideTab.value === 'vars' && void loadValues(),
    { immediate: true },
  )

  const vEdit = ref<TermVar>()
  const vNew = ref(false)
  const vErr = computed(() => (vEdit.value ? varNameError(vEdit.value, cfg.value.vars) : ''))
  function addVar(): void {
    vEdit.value = { id: presetId(), name: '', value: '', js: false }
    vNew.value = true
  }
  function editVar(v: TermVar): void {
    vEdit.value = { ...v }
    vNew.value = false
  }
  function saveVar(): void {
    const v = vEdit.value
    if (!v || vErr.value) return
    upsertById(cfg.value.vars, v)
    vEdit.value = undefined
    saveCfg({ vars: cfg.value.vars })
    void loadValues()
  }
  function removeVar(v: TermVar): void {
    if (!confirm(`Удалить переменную «${v.name}»?`)) return
    cfg.value.vars = cfg.value.vars.filter((x) => x.id !== v.id)
    saveCfg({ vars: cfg.value.vars })
    void loadValues()
  }

  /** The variable whose insert was just copied (a moment's «скопировано»). */
  const copied = ref('')
  function copyVar(name: string): void {
    void navigator.clipboard.writeText(insertOf(name))
    copied.value = name
    setTimeout(() => copied.value === name && (copied.value = ''), 1200)
  }
  return { values, loadValues, vEdit, vNew, vErr, addVar, editVar, saveVar, removeVar, copied, copyVar }
}
