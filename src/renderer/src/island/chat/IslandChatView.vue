<script setup lang="ts">
/**
 * A room's whole chat in the island (the same parts as a note's chat: files, voices, answers, reactions, «@» for
 * people and AI): ‹ › browse the rooms, the title — the list to choose a room or the feed (kept), ↗ — the room in the
 * app. The room stays while it is in sight. `lead` — what goes first in the head (the orb's switch next to the pill).
 */
import { nextTick, ref, watch } from 'vue'
import ChatThread from '@nb/blocks/chat/ChatThread.vue'
import Icon from '../../components/Icon.vue'
import { useIsland } from '../islandState'

const { chat } = useIsland()
const { state, room, current, ready, picking, chosen, error } = chat
const thread = ref<InstanceType<typeof ChatThread>>()

// a room come into sight: its input ready to write
watch(
  () => [room.value, ready.value, picking.value] as const,
  ([, on, list]) => on && !list && void nextTick(() => thread.value?.focus()),
  { immediate: true },
)
/** Esc with nothing typed closes the chat next to the pill (typing — the input's own: a mention list, a recording). */
function onEsc(e: KeyboardEvent): void {
  const t = e.target as HTMLElement
  if (t instanceof HTMLTextAreaElement && t.value.trim()) return
  if (chat.open.value) chat.close()
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:min-h-0 tw:cursor-auto" @keydown.esc.capture="onEsc">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-4 tw:min-w-0 tw:text-[12px] tw:whitespace-nowrap">
      <slot name="lead" />
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Предыдущий чат" :disabled="state.rooms.length < 2" @click="chat.step(-1)"><Icon name="chevronLeft" :size="14" /></button>
      <button class="tw:inline-flex tw:flex-1 tw:items-center tw:justify-center tw:gap-6 tw:min-w-0 tw:h-24 tw:py-0 tw:px-8 tw:border-0 tw:rounded-full tw:bg-white/6 tw:text-text tw:hover:bg-white/10" :title="chosen ? 'Выбрать чат или ленту' : 'Лента: открывается чат с новыми сообщениями — выбрать чат'" @click="picking = !picking">
        <Icon :name="chosen ? 'chat' : 'inbox'" :size="12" class="tw:flex-none tw:text-muted" />
        <b class="tw:min-w-0 tw:truncate">{{ current?.title ?? 'Чатов нет' }}</b>
        <Icon name="chevronDown" :size="12" class="tw:flex-none tw:text-muted" />
      </button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Следующий чат" :disabled="state.rooms.length < 2" @click="chat.step(1)"><Icon name="chevronRight" :size="14" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Открыть в приложении" :disabled="!current" @click="chat.openInApp()"><Icon name="external" :size="12" /></button>
    </div>

    <!-- the rooms to choose (or the feed) -->
    <div v-if="picking" class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:py-4 tw:px-6 tw:rounded-[14px] tw:bg-white/4">
      <button class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-auto tw:py-6 tw:px-8 tw:border-0 tw:rounded-[10px] tw:bg-transparent tw:text-left tw:hover:bg-white/8 tw:[&.on]:bg-accent/18" :class="{ on: !chosen }" @click="chat.choose('')">
        <Icon name="inbox" :size="14" class="tw:flex-none tw:text-muted" />
        <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1"><b class="tw:text-[12px]">Лента</b><span class="tw:text-muted tw:text-[11px] tw:truncate">Открывается чат с новыми сообщениями</span></span>
      </button>
      <button v-for="r in state.rooms" :key="r.id" class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-auto tw:py-6 tw:px-8 tw:border-0 tw:rounded-[10px] tw:bg-transparent tw:text-left tw:hover:bg-white/8 tw:[&.on]:bg-accent/18" :class="{ on: chosen === r.id }" @click="chat.choose(r.id)">
        <Icon name="chat" :size="14" class="tw:flex-none tw:text-muted" />
        <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1">
          <b class="tw:text-[12px] tw:truncate">{{ r.title }}</b>
          <span v-if="r.homeless" class="tw:text-warn-fg tw:text-[11px] tw:truncate">ни в одной заметке — документ удалён</span>
          <span v-else-if="r.last" class="tw:text-muted tw:text-[11px] tw:truncate">{{ r.last.author }}: {{ r.last.text }}</span>
        </span>
        <span v-if="r.unread" class="tw:flex-none tw:min-w-17 tw:h-17 tw:px-4 tw:rounded-full tw:bg-accent tw:text-on-accent tw:text-[10px] tw:font-bold tw:leading-17 tw:text-center">{{ r.unread }}</span>
        <span v-if="r.homeless" class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-full tw:text-muted tw:hover:bg-white/10 tw:hover:text-down-fg" title="Удалить чат" @click.stop="chat.remove(r.id, r.title)"><Icon name="trash" :size="12" /></span>
      </button>
      <p v-if="!state.rooms.length" class="tw:m-8 tw:text-muted tw:text-[12px]">Чатов пока нет</p>
    </div>
    <!-- the room's whole chat -->
    <ChatThread v-else-if="ready && room" ref="thread" :room="room" :readonly="!state.shown?.writable" />
    <p v-else class="tw:flex-1 tw:m-0 tw:pt-30 tw:text-center tw:text-muted tw:text-[12px]">{{ current ? 'Загружается…' : 'Чатов пока нет — создайте чат в Блокноте' }}</p>

    <span v-if="error" class="tw:flex-none tw:text-down-fg tw:text-[11px] tw:truncate">{{ error }}</span>
  </div>
</template>
