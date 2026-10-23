<script setup lang="ts">
/** Settings · local speech recognition: on / after recording, the microphone, the models (download / delete). */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { VoiceState } from '@shared/types'
import { WHISPER_MODELS } from '@shared/voice'
import { remoteError } from '../../../../shared/remoteError'
import { useSettingsContext } from './settingsContext'

const { f, cat, apply } = useSettingsContext()
const voice = shallowRef<VoiceState>({ modelReady: false, model: 'small', models: [], busy: [] })
void window.qa.voiceState().then((s) => (voice.value = s))
const offVoice = window.qa.onVoice((s) => (voice.value = s))
onBeforeUnmount(offVoice)
const voiceErr = ref('')
/** Speech settings apply at once (no "Сохранить" needed). */
async function applyVoice(): Promise<void> {
  await apply({ voice: { enabled: f.voiceEnabled, autoTranscribe: f.autoTranscribe, model: f.voiceModel, micId: f.micId } })
}
/** The system's aliases of another microphone (the default one, the one for calls) — not listed on their own. */
const MIC_ALIAS_IDS: ReadonlySet<string> = new Set(['default', 'communications'])
/** The microphones (their names show once access to the mic was given — asked here once). */
const mics = ref<Array<{ id: string; label: string }>>([])
async function loadMics(ask = false): Promise<void> {
  try {
    let list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    if (ask && list.length && list.every((d) => !d.label)) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    }
    mics.value = list
      .filter((d) => !MIC_ALIAS_IDS.has(d.deviceId))
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Микрофон ${i + 1}` }))
  } catch {
    mics.value = []
  }
}
watch(cat, (c) => c === 'voice' && void loadMics(true), { immediate: true })
const onDevices = () => void loadMics()
navigator.mediaDevices?.addEventListener('devicechange', onDevices)
onBeforeUnmount(() => navigator.mediaDevices?.removeEventListener('devicechange', onDevices))
/** The picked one is not connected now (recording falls back to the default). */
const micMissing = computed(() => !!f.micId && mics.value.length > 0 && !mics.value.some((m) => m.id === f.micId))
async function downloadModel(id: string): Promise<void> {
  voiceErr.value = ''
  try {
    await window.qa.voiceDownloadModel(id)
  } catch (e) {
    voiceErr.value = remoteError(e)
  }
}
async function deleteModel(id: string, label: string): Promise<void> {
  if (confirm(`Удалить модель ${label}? Её можно будет скачать снова.`)) await window.qa.voiceDeleteModel(id)
}
const isReady = (id: string) => voice.value.models.find((m) => m.id === id)?.ready ?? false
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} ГБ` : `${Math.round(b / 1e6)} МБ`)
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Распознавание речи (локально)</h3>
      <p class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Голосовые заметки и записи звонков расшифровываются на этом компьютере (whisper.cpp), без интернета и облаков. Модели скачиваются по желанию и проверяются по контрольной сумме; ненужную можно удалить. Записи сохраняются в любом случае.</p>
      <div class="jrow tw:flex tw:items-center tw:gap-12 tw:flex-wrap tw:mt-12">
        <label class="check tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[13px]"><input class="tw:[.secret_&]:flex-1" v-model="f.voiceEnabled" type="checkbox" @change="applyVoice" /> Расшифровка включена</label>
        <label class="check tw:[&.off]:opacity-50 tw:flex tw:flex-row tw:items-center tw:gap-8 tw:text-text tw:text-[13px]" :class="{ off: !f.voiceEnabled }"><input class="tw:[.secret_&]:flex-1" v-model="f.autoTranscribe" type="checkbox" :disabled="!f.voiceEnabled" @change="applyVoice" /> Сразу после записи</label>
        <span v-if="voiceErr || voice.error" class="err tw:text-down-fg tw:text-[13px]">{{ voiceErr || voice.error }}</span>
      </div>
      <div class="fields tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-12">
        <label class="span2 tw:col-span-full tw:flex tw:flex-col tw:gap-4 tw:text-[12px] tw:text-muted">
          Микрофон
          <select v-model="f.micId" @change="applyVoice">
            <option value="">По умолчанию в системе</option>
            <option v-for="m in mics" :key="m.id" :value="m.id">{{ m.label }}</option>
            <option v-if="micMissing" :value="f.micId">Выбранный (сейчас не подключён)</option>
          </select>
        </label>
      </div>
      <p v-if="micMissing" class="muted small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-[12px]">Выбранный микрофон не подключён — пока его нет, запись идёт с микрофона по умолчанию.</p>
      <div class="models tw:flex tw:flex-col tw:gap-4 tw:mt-10 tw:[&.off]:opacity-50" :class="{ off: !f.voiceEnabled }">
        <div v-for="m in WHISPER_MODELS" :key="m.id" class="model tw:flex tw:items-center tw:flex-wrap tw:gap-y-4 tw:gap-x-10 tw:py-5 tw:px-10 tw:rounded-[4px] tw:border tw:border-transparent tw:[&.cur]:border-accent/50 tw:[&.cur]:bg-accent/8" :class="{ cur: f.voiceModel === m.id }">
          <label class="pick tw:inline-flex tw:flex-row tw:items-center tw:gap-8 tw:min-w-160 tw:text-text tw:text-[13px]" :title="isReady(m.id) ? 'Использовать эту модель' : 'Сначала скачайте модель'">
            <input class="tw:[.secret_&]:flex-1" v-model="f.voiceModel" type="radio" :value="m.id" :disabled="!f.voiceEnabled" @change="applyVoice" />
            <b>{{ m.label }}</b>
          </label>
          <span class="muted small tw:text-[12px]">{{ mb(m.bytes) }} · {{ m.note }}</span>
          <span class="spacer tw:flex-1"></span>
          <template v-if="voice.downloading?.id === m.id">
            <span class="prog tw:w-160 tw:max-w-full tw:h-6 tw:rounded-r2 tw:bg-white/8 tw:overflow-hidden"><span class="tw:block tw:h-full tw:bg-accent tw:[transition:width_0.3s]" :style="{ width: `${Math.round(voice.downloading.progress * 100)}%` }"></span></span>
            <span class="muted small tw:text-[12px]">{{ Math.round(voice.downloading.progress * 100) }}%</span>
          </template>
          <template v-else-if="isReady(m.id)">
            <span class="ok small tw:text-up-fg tw:text-[13px]">скачана</span>
            <button class="linkbtn danger tw:text-down-fg tw:border-0 tw:py-2 tw:px-0 tw:bg-transparent tw:text-[12px] tw:cursor-pointer tw:hover:underline tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg3_button+&]:border-border-3" @click="deleteModel(m.id, m.label)">удалить</button>
          </template>
          <button v-else class="linkbtn tw:border-0 tw:py-2 tw:px-0 tw:bg-transparent tw:text-accent-fg tw:text-[12px] tw:cursor-pointer tw:hover:underline tw:[.seg3_button+&]:border-l tw:[.seg3_button+&]:border-l-border-2 tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg3_button+&]:border-border-3" :disabled="!!voice.downloading" @click="downloadModel(m.id)">скачать</button>
        </div>
        <p v-if="f.voiceEnabled && !isReady(f.voiceModel)" class="err small tw:mt-0 tw:mr-0 tw:mb-12 tw:ml-0 tw:text-down-fg tw:text-[13px]">Выбранная модель не скачана — расшифровка не сработает, пока её не скачать.</p>
      </div>
    </section>
</template>
