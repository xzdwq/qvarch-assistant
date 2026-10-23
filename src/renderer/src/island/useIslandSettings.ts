import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { PublicSettings } from '@shared/types'
import { DEFAULT_UI } from '@shared/ui'
import { setKinds } from '../lib/palette'

/** The island's settings (reloaded on every expand, pushed on change) and whether a transcription is running. */
export function useIslandSettings() {
  const settings = shallowRef<PublicSettings>()
  function apply(s: PublicSettings): void {
    settings.value = s
    setKinds(s.kinds)
  }
  async function loadSettings(): Promise<void> {
    apply(await window.qa.getSettings())
  }
  const offSettings = window.qa.onSettings(apply)
  /** What the user chose to show (Настройки → Интерфейс). */
  const ui = computed(() => settings.value?.ui ?? DEFAULT_UI)

  /** A transcription is running / queued (the orb "thinks" meanwhile). */
  const voiceBusy = ref(false)
  void window.qa.voiceState().then((v) => (voiceBusy.value = v.busy.length > 0))
  const offVoice = window.qa.onVoice((v) => (voiceBusy.value = v.busy.length > 0))

  onBeforeUnmount(() => {
    offSettings()
    offVoice()
  })
  return { settings, loadSettings, ui, voiceBusy }
}

export type IslandSettings = ReturnType<typeof useIslandSettings>
