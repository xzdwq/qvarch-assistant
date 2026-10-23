import { inject, provide, reactive, ref, watch, type InjectionKey, type Ref } from 'vue'
import type { PublicSettings, SettingsPatch, UiPrefs } from '@shared/types'
import { settingsFormFrom, settingsPatchFrom, type SettingsForm } from '@shared/settingsForm'
import { readSettingsCategory, rememberSettingsCategory, type SettingsCategoryId } from './settingsCategories'

/** What every settings section shares: the form, the interface prefs, the open section and the ways to keep them. */
export interface SettingsContext {
  /** The settings the screen opened with (a section with a form of its own starts it from them). */
  initial: PublicSettings
  f: SettingsForm
  /** What the interface shows — applied at once, every window follows. */
  ui: UiPrefs
  cat: Ref<SettingsCategoryId>
  saved: Ref<boolean>
  saveError: Ref<string>
  /** Keeps the whole form (and a newly typed Jira secret). */
  save: () => Promise<void>
  /** Applies a part of the settings at once. */
  apply: (patch: SettingsPatch) => Promise<void>
  applyUi: () => Promise<void>
}
const SETTINGS_CONTEXT: InjectionKey<SettingsContext> = Symbol('settings')

/** The settings screen's shared state, made by the screen and given to its sections. */
export function provideSettingsContext(initial: PublicSettings, onChanged: (s: PublicSettings) => void): SettingsContext {
  const f = reactive(settingsFormFrom(initial))
  const ui = reactive<UiPrefs>(JSON.parse(JSON.stringify(initial.ui)) as UiPrefs)
  const cat = ref<SettingsCategoryId>(readSettingsCategory())
  watch(cat, (v) => rememberSettingsCategory(v))
  const saved = ref(false)
  const saveError = ref('')

  async function apply(patch: SettingsPatch): Promise<void> {
    onChanged(await window.qa.updateSettings(patch))
  }
  async function applyUi(): Promise<void> {
    await apply({ ui: JSON.parse(JSON.stringify(ui)) as UiPrefs })
  }
  async function save(): Promise<void> {
    try {
      // the form is reactive: nested arrays (work days) are proxies, which IPC cannot clone — send plain data
      const s = await window.qa.updateSettings(JSON.parse(JSON.stringify(settingsPatchFrom(f))) as SettingsPatch)
      // the secret goes to the encrypted store, never into settings.json
      if (f.jiraSecret.trim()) {
        await window.qa.jiraSetSecret(f.jiraSecret)
        f.jiraSecret = ''
      }
      onChanged(s)
      saveError.value = ''
      saved.value = true
      setTimeout(() => (saved.value = false), 2000)
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e)
    }
  }

  const ctx: SettingsContext = { initial, f, ui, cat, saved, saveError, save, apply, applyUi }
  provide(SETTINGS_CONTEXT, ctx)
  return ctx
}

/** The settings screen's shared state, inside one of its sections. */
export function useSettingsContext(): SettingsContext {
  const ctx = inject(SETTINGS_CONTEXT)
  if (!ctx) throw new Error('useSettingsContext: outside the settings screen')
  return ctx
}
