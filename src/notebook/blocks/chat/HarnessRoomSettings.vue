<script setup lang="ts">
/**
 * This chat's harness settings (who reviews at the end, the limits, the plan shown first): a button and its popover.
 * Set here — the chat keeps them for its next runs, its run going on holds to them at once.
 */
import { reactive, ref, watch } from 'vue'
import type { HarnessSettings } from '@shared/agent/harness/constants'
import { cleanHarnessSettings } from '@shared/agent/harness/settings'
import { remoteError } from '@shared/remoteError'
import Popover from '@renderer/components/Popover.vue'
import Icon from '@renderer/components/Icon.vue'
import HarnessSettingsFields from '@renderer/app/settings/HarnessSettingsFields.vue'
import { useChatPort } from './chatPort'

const props = defineProps<{ room: string; size?: number }>()
const port = useChatPort().harness!
const btn = ref<HTMLElement>()
const open = ref(false)
const form = reactive<HarnessSettings>(cleanHarnessSettings(port.settingsOf(props.room)))
const error = ref('')
// (opened — as they are now: the run may have changed them meanwhile)
watch(open, (o) => o && Object.assign(form, cleanHarnessSettings(port.settingsOf(props.room))))
async function apply(): Promise<void> {
  error.value = ''
  try {
    await port.setSettings(props.room, cleanHarnessSettings(form))
  } catch (e) {
    error.value = remoteError(e)
  }
}
</script>

<template>
  <button
    ref="btn"
    class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:text-accent-fg"
    :class="[{ on: open }, size ? 'tw:w-36 tw:h-36' : 'tw:w-20 tw:h-20']"
    title="Настройки harness этого чата: финальная проверка, лимиты"
    @click="open = !open"
  >
    <Icon name="settings" :size="size ?? 12" />
  </button>
  <Popover v-model:open="open" :anchor="btn" :width="260" :chrome="0" class="tw:flex tw:flex-col tw:gap-6 tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="{ overflowY: 'auto' }">
    <b class="tw:text-[12px]">Harness этого чата</b>
    <HarnessSettingsFields v-model="form" @change="apply" />
    <span v-if="error" class="tw:text-down-fg tw:text-[12px]">{{ error }}</span>
    <span class="tw:text-muted tw:text-[11px]">Чат запомнит их для следующих работ; для новых чатов — Настройки → ИИ-агенты.</span>
  </Popover>
</template>
