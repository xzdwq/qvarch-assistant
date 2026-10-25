import { computed, shallowRef } from 'vue'

/**
 * Whether speech can be made words here: recognition on (Настройки → Голос) and its model downloaded. Read once, then
 * followed (a model downloaded, the switch turned) — one subscription for every voice message shown.
 */
const enabled = shallowRef(false)
const modelReady = shallowRef(false)
let started = false
function start(): void {
  if (started) return
  started = true
  void window.qa.getSettings().then((s) => (enabled.value = s.voice.enabled))
  window.qa.onSettings((s) => (enabled.value = s.voice.enabled))
  void window.qa.voiceState().then((v) => (modelReady.value = v.modelReady))
  window.qa.onVoice((v) => (modelReady.value = v.modelReady))
}
export const canTranscribe = computed(() => {
  start()
  return enabled.value && modelReady.value
})
