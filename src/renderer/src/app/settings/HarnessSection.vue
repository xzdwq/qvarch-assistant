<script setup lang="ts">
/**
 * Settings · harness (an agent's work in a chat by plan, steps and checks): a new chat's settings — a chat set in its
 * own menu keeps its own; its instructions for kinds of tasks (HarnessGuides). Applied at once.
 */
import { reactive, ref, watch } from 'vue'
import type { HarnessSettings } from '@shared/agent/harness/constants'
import { cleanHarnessSettings } from '@shared/agent/harness/settings'
import { remoteError } from '@shared/remoteError'
import Icon from '../../components/Icon.vue'
import { harnessSettings, saveHarnessSettings } from '../../lib/harness/harnessDriver'
import HarnessGuides from './HarnessGuides.vue'
import HarnessSettingsFields from './HarnessSettingsFields.vue'

const form = reactive<HarnessSettings>(cleanHarnessSettings(harnessSettings.value))
watch(harnessSettings, (s) => Object.assign(form, cleanHarnessSettings(s)))
const error = ref('')
async function apply(): Promise<void> {
  error.value = ''
  try {
    await saveHarnessSettings(cleanHarnessSettings(form))
  } catch (e) {
    error.value = remoteError(e)
  }
}
</script>

<template>
  <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
    <h3 class="tw:mt-0 tw:mb-8 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Harness</h3>
    <p class="tw:mt-0 tw:mb-10 tw:text-muted tw:text-[12px]">
      Кнопка <Icon name="repeat" :size="11" /> в поле ввода чата: сообщение становится целью. ИИ выбирает подходящие инструкции, составляет план с критериями, работает по шагам; приложение само
      запускает проверки и вызывает ИИ снова, пока всё не пройдёт. Здесь — настройки для нового чата; в самом чате их можно изменить (<Icon name="settings" :size="11" /> рядом с кнопкой harness) — чат запомнит свои.
    </p>
    <HarnessSettingsFields v-model="form" @change="apply" />
    <span v-if="error" class="tw:text-down-fg tw:text-[12px]">{{ error }}</span>
    <HarnessGuides />
    <p class="tw:mt-6 tw:mb-0 tw:text-muted tw:text-[12px]">Свои правила для одной работы — раздел «## Правила harness» в документе, где чат.</p>
  </section>
</template>
