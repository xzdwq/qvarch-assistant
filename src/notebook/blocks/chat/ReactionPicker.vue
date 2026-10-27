<script setup lang="ts">
/**
 * The reactions of a message to put: the ones this person puts most in a row, «▾» — every emoji (searched by a word); a pick puts it
 * (one already one's own — takes it back) and closes. Opened by the button in a message's corner only.
 */
import { ref, watch } from 'vue'
import { loadQuickReactions, quickReactions } from '@renderer/lib/quickReactions'
import EmojiPick from '@renderer/components/EmojiPick.vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'

defineProps<{ anchor: HTMLElement | undefined }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [emoji: string] }>()
const all = ref(false)
watch(open, (on) => on && loadQuickReactions())
function pick(e: string): void {
  emit('pick', e)
  open.value = false
  all.value = false
}
</script>

<template>
  <Popover v-model:open="open" :anchor="anchor" :width="all ? 356 : 246" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-6 tw:p-6 tw:border tw:border-border-2 tw:rounded-[18px] tw:bg-pop tw:shadow-pop">
    <div class="tw:flex tw:items-center tw:gap-2">
      <button v-for="e in quickReactions" :key="e" class="tw:inline-flex tw:items-center tw:justify-center tw:w-32 tw:h-32 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-[19px] tw:hover:bg-hover tw:hover:scale-110" :title="e" @click="pick(e)">{{ e }}</button>
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:ml-auto tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: all }" title="Все эмодзи" @click="all = !all"><Icon name="chevronDown" :size="14" /></button>
    </div>
    <EmojiPick v-if="all" class="tw:[&&]:w-auto tw:[&&]:border-0 tw:[&&]:p-0 tw:[&&]:shadow-none" @pick="pick" />
  </Popover>
</template>
