<script setup lang="ts">
/**
 * A chat's settings, one button: its notifications (its own way — on / off; as all chats until set) and whether the
 * room's others may call one's own AI here (off by default: one's AI answers oneself only). A local chat has no others.
 */
import { computed, ref } from 'vue'
import { notifiesIn } from '@shared/transport/constants'
import type { ChatRoom } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { setMyAgentsOpen } from '@renderer/lib/agents'
import { chatMe, chatPrefs } from '@renderer/lib/chat'
import { setChatNotify } from '@renderer/lib/chatActions'

const props = defineProps<{ room: ChatRoom; live: boolean; local: boolean }>()
const btn = ref<HTMLElement>()
const open = ref(false)
const busy = ref(false)
const error = ref('')

const notifies = computed(() => notifiesIn(chatPrefs.value, props.room.id))
const mine = computed(() => (props.room.agents ?? []).filter((a) => a.owner === chatMe.value))
const agentsOpen = computed(() => mine.value.some((a) => a.open))
/** Why the AI switch is off-limits (none — it may be switched). */
const agentsWhy = computed(() => (props.local ? 'В чате без сервера других участников нет' : !mine.value.length ? 'Сначала добавьте свой ИИ в чат (кнопка «ИИ»)' : !props.live ? 'Нужен сервер' : ''))

/** A change done (failed — said; the switch shows the state as it is, not as clicked). */
async function act(fn: () => Promise<unknown>, box: EventTarget | null, now: () => boolean): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = remoteError(e)
  } finally {
    busy.value = false
    if (box instanceof HTMLInputElement) box.checked = now()
  }
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex tw:flex-none">
    <button
      class="tw:relative tw:inline-flex tw:flex-none tw:w-26 tw:h-26 tw:p-0 tw:items-center tw:justify-center tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:bg-hover tw:[&.on]:text-text"
      :class="{ on: open }"
      :title="`Настройки чата: ${notifies ? 'звук включён' : 'звук выключен'}${agentsOpen ? ', ваш ИИ могут звать другие' : ''}`"
      @click="open = !open"
    >
      <Icon name="settings" :size="14" />
    </button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="260" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-4 tw:p-10 tw:border tw:border-border-2 tw:rounded-[14px] tw:bg-pop tw:shadow-pop tw:text-[12.5px] tw:whitespace-normal">
    <label class="tw:flex tw:items-center tw:gap-8 tw:min-h-30 tw:px-4 tw:rounded-[10px] tw:cursor-pointer tw:hover:bg-hover">
      <Icon :name="notifies ? 'bell' : 'bellOff'" :size="14" class="tw:flex-none tw:text-muted" />
      <span class="tw:flex-1 tw:min-w-0 tw:truncate">Уведомления и звук</span>
      <input type="checkbox" :checked="notifies" :disabled="busy" @change="(e) => act(() => setChatNotify(room.id, !notifies), e.target, () => notifies)" />
    </label>
    <label
      class="tw:flex tw:items-center tw:gap-8 tw:min-h-30 tw:px-4 tw:rounded-[10px] tw:cursor-pointer tw:hover:bg-hover"
      :class="{ 'tw:opacity-60 tw:cursor-default': !!agentsWhy }"
      :title="agentsWhy || 'Другим он только читает и пишет в общий документ этого чата — ничего не создаёт и не меняет у вас'"
    >
      <Icon name="sparkles" :size="14" class="tw:flex-none tw:text-muted" />
      <span class="tw:flex-1 tw:min-w-0 tw:truncate">Мой ИИ могут звать другие</span>
      <input type="checkbox" :checked="agentsOpen" :disabled="busy || !!agentsWhy" @change="(e) => act(() => setMyAgentsOpen(room, !agentsOpen), e.target, () => agentsOpen)" />
    </label>
    <span v-if="error" class="tw:text-down-fg">{{ error }}</span>
  </Popover>
</template>
