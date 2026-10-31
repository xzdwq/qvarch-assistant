<script setup lang="ts">
/** A note's mark of the AI in it (a tab, the tree): a green pulse — it works; a blinking person — it waits for you. */
import type { AiSignal } from '@shared/agent/harness/constants'
import Icon from './Icon.vue'

defineProps<{ signal: AiSignal; size?: number }>()
</script>

<template>
  <span v-if="signal === 'human'" class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:text-warn-fg tw:animate-pulse" title="ИИ ждёт вас: план или вопрос в чате документа"><Icon name="users" :size="size ?? 12" /></span>
  <span v-else class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center" :style="{ width: `${size ?? 12}px`, height: `${size ?? 12}px` }" title="ИИ работает в этом документе"><i class="tw:w-7 tw:h-7 tw:rounded-full tw:bg-up tw:animate-pulse tw:[box-shadow:0_0_6px_color-mix(in_srgb,var(--up)_60%,transparent)]"></i></span>
</template>
