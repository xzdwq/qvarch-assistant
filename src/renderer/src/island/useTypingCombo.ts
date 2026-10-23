import { computed, onBeforeUnmount, ref } from 'vue'
import { COMBO_GAP_MS, type ComboState } from '@shared/combo'
import type { IslandSettings } from './useIslandSettings'

/**
 * The typing combo: only counts arrive here (never which keys). While typing the live streak shakes, grows and
 * reddens with the combo; after a pause it is over and the day's best is shown.
 */
export function useTypingCombo({ settings }: IslandSettings) {
  const combo = ref<ComboState>({ current: 0, last: 0, best: 0 })
  const typing = ref(false)
  let comboTimer: ReturnType<typeof setTimeout> | undefined
  void window.qa.getCombo().then((c) => (combo.value = c))
  const offCombo = window.qa.onCombo((c) => {
    combo.value = c
    typing.value = c.current > 1
    clearTimeout(comboTimer)
    comboTimer = setTimeout(() => (typing.value = false), COMBO_GAP_MS)
  })
  onBeforeUnmount(offCombo)
  /** 0 → 1 as the streak grows to 150 presses: drives size, shake and colour. */
  const heat = computed(() => Math.min(1, combo.value.current / 150))
  const comboOn = computed(() => settings.value?.countKeys !== false && (typing.value || combo.value.best > 0))
  return { combo, typing, heat, comboOn }
}
