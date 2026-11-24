import { ref } from 'vue'
import { presetId, type TermPreset } from '@shared/terminal'
import { presetToKeep, upsertById } from '@shared/terminalEdit'
import type { TermConfigState } from './useTermConfig'

/** The preset dialog: a new or an existing preset edited on a copy, kept into the list; removing one. */
export function usePresetEditor({ cfg, saveCfg }: TermConfigState) {
  const editing = ref<TermPreset>()
  const isNew = ref(false)
  const savePresets = () => saveCfg({ presets: cfg.value.presets })

  function addPreset(): void {
    editing.value = { id: presetId(), name: '', cmd: '', run: true }
    isNew.value = true
  }
  function edit(p: TermPreset): void {
    editing.value = { ...p }
    isNew.value = false
  }
  /** Kept (see presetToKeep: a preset of only a script runs it, one without a name is named by its command). */
  function saveEdit(): void {
    const e = editing.value && presetToKeep(editing.value)
    if (!e) return
    upsertById(cfg.value.presets, e)
    editing.value = undefined
    savePresets()
  }
  function removePreset(p: TermPreset): void {
    if (!confirm(`Удалить пресет «${p.name}»?`)) return
    cfg.value.presets = cfg.value.presets.filter((x) => x.id !== p.id)
    savePresets()
  }
  return { editing, isNew, addPreset, edit, saveEdit, removePreset }
}
