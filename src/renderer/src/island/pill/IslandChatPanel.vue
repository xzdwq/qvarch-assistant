<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ISLAND_DRAWERS } from '@shared/tracker/islandGeometry'
import Icon from '../../components/Icon.vue'
import { useIsland } from '../islandState'

/**
 * The chat area the orb (or the unread count) opens: one room's latest messages and a reply — the room stays while
 * it is open; ‹ › browse the rooms, the title — the list to choose a room or the feed (kept); «Заметка» — the orb
 * opens the quick note again. A double click on a message answers it.
 */
const { els, chat, switchOrb } = useIsland()
const { open, current, messages, picking, text, reply, error, sending, state, chosen } = chat
const list = ref<HTMLElement>()
const height = `${ISLAND_DRAWERS.chat.h - 8}px`
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

// the latest at the bottom, in view
watch(
  () => [messages.value.length, messages.value.at(-1)?.seq, picking.value],
  () => void nextTick(() => list.value && (list.value.scrollTop = list.value.scrollHeight)),
)
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') return chat.close()
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
  e.preventDefault()
  void chat.send()
}
</script>

<template>
  <div
    v-if="open"
    class="tw:absolute tw:left-10 tw:right-10 tw:top-full tw:flex tw:flex-col tw:gap-6 tw:cursor-auto tw:animate-[Island-nslide_0.3s_cubic-bezier(0.32,0.72,0,1)_0.05s_both] tw:group-[.up]/stage:top-auto tw:group-[.up]/stage:bottom-full tw:group-[.up]/stage:pt-6"
    :style="{ height }"
    @click.stop
  >
    <div class="tw:flex tw:items-center tw:gap-4 tw:min-w-0 tw:text-[12px] tw:whitespace-nowrap">
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-white/12 tw:rounded-full tw:bg-transparent tw:text-muted tw:text-[11px] tw:hover:text-text" title="Сфера открывает быструю заметку" @click="switchOrb('note')"><Icon name="note" :size="12" />Заметка</button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Предыдущий чат" :disabled="state.rooms.length < 2" @click="chat.step(-1)"><Icon name="chevronLeft" :size="14" /></button>
      <button class="tw:inline-flex tw:flex-1 tw:items-center tw:justify-center tw:gap-6 tw:min-w-0 tw:h-24 tw:py-0 tw:px-8 tw:border-0 tw:rounded-full tw:bg-white/6 tw:text-text tw:hover:bg-white/10" :title="chosen ? 'Выбрать чат или ленту' : 'Лента: открывается чат с новыми сообщениями — выбрать чат'" @click="picking = !picking">
        <Icon :name="chosen ? 'chat' : 'inbox'" :size="12" class="tw:flex-none tw:text-muted" />
        <b class="tw:min-w-0 tw:truncate">{{ current?.title ?? 'Чатов нет' }}</b>
        <Icon name="chevronDown" :size="12" class="tw:flex-none tw:text-muted" />
      </button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Следующий чат" :disabled="state.rooms.length < 2" @click="chat.step(1)"><Icon name="chevronRight" :size="14" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:text-text" title="Открыть в приложении" :disabled="!current" @click="chat.openInApp()"><Icon name="external" :size="12" /></button>
    </div>

    <div ref="list" class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:py-4 tw:px-6 tw:rounded-[14px] tw:bg-white/4">
      <!-- the rooms to choose (or the feed) -->
      <template v-if="picking">
        <button class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-auto tw:py-6 tw:px-8 tw:border-0 tw:rounded-[10px] tw:bg-transparent tw:text-left tw:hover:bg-white/8 tw:[&.on]:bg-accent/18" :class="{ on: !chosen }" @click="chat.choose('')">
          <Icon name="inbox" :size="14" class="tw:flex-none tw:text-muted" />
          <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1"><b class="tw:text-[12px]">Лента</b><span class="tw:text-muted tw:text-[11px] tw:truncate">Открывается чат с новыми сообщениями</span></span>
        </button>
        <button v-for="r in state.rooms" :key="r.id" class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-auto tw:py-6 tw:px-8 tw:border-0 tw:rounded-[10px] tw:bg-transparent tw:text-left tw:hover:bg-white/8 tw:[&.on]:bg-accent/18" :class="{ on: chosen === r.id }" @click="chat.choose(r.id)">
          <Icon name="chat" :size="14" class="tw:flex-none tw:text-muted" />
          <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1">
            <b class="tw:text-[12px] tw:truncate">{{ r.title }}</b>
            <span v-if="r.last" class="tw:text-muted tw:text-[11px] tw:truncate">{{ r.last.author }}: {{ r.last.text }}</span>
          </span>
          <span v-if="r.unread" class="tw:flex-none tw:min-w-17 tw:h-17 tw:px-4 tw:rounded-full tw:bg-accent tw:text-on-accent tw:text-[10px] tw:font-bold tw:leading-17 tw:text-center">{{ r.unread }}</span>
        </button>
        <p v-if="!state.rooms.length" class="tw:m-8 tw:text-muted tw:text-[12px]">Чатов пока нет</p>
      </template>
      <!-- the room's latest messages -->
      <template v-else>
        <p v-if="!messages.length" class="tw:m-8 tw:text-center tw:text-muted tw:text-[12px]">{{ current ? 'Сообщений пока нет' : 'Чатов пока нет — создайте чат в Блокноте' }}</p>
        <div v-for="m in messages" :key="m.seq" class="tw:flex tw:mt-4" :class="m.mine ? 'tw:justify-end' : 'tw:justify-start'" @dblclick="reply = m">
          <div class="tw:max-w-[82%] tw:min-w-0 tw:py-4 tw:px-10 tw:rounded-[14px] tw:text-[12px] tw:leading-[1.4]" :class="m.mine ? 'tw:bg-accent/30' : 'tw:bg-white/8'" :title="`${hm(m.at)} · двойной клик — ответить`">
            <b v-if="!m.mine" class="tw:block tw:text-accent-fg tw:text-[11px]">{{ m.author }}</b>
            <span v-if="m.reply" class="tw:block tw:mb-2 tw:pl-6 tw:border-l-2 tw:border-l-accent tw:text-muted tw:text-[11px] tw:truncate">{{ m.reply.author }}: {{ m.reply.text }}</span>
            <span class="tw:text-text tw:whitespace-pre-wrap tw:wrap-anywhere">{{ m.text }}</span>
          </div>
        </div>
      </template>
    </div>

    <span v-if="error" class="tw:text-down-fg tw:text-[11px] tw:truncate">{{ error }}</span>
    <div v-if="reply" class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:py-2 tw:px-8 tw:rounded-[10px] tw:bg-accent/12 tw:text-[11px]">
      <Icon name="reply" :size="12" class="tw:flex-none tw:text-accent-fg" />
      <span class="tw:min-w-0 tw:flex-1 tw:truncate"><b class="tw:text-accent-fg">{{ reply.author }}</b> {{ reply.text }}</span>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:text-text" title="Не отвечать" @click="reply = undefined"><Icon name="x" :size="10" /></button>
    </div>
    <div class="tw:flex tw:items-end tw:gap-6">
      <textarea
        :ref="els.chatInput"
        v-model="text"
        rows="1"
        class="tw:flex-1 tw:min-w-0 tw:min-h-32 tw:max-h-80 tw:py-6 tw:px-12 tw:resize-none tw:rounded-[16px] tw:border tw:border-white/12 tw:bg-white/4 tw:text-text tw:text-[12px] tw:leading-[1.4] tw:outline-none tw:field-sizing-content tw:focus:border-accent/60"
        :placeholder="current ? `Ответить в «${current.title}» · Enter` : 'Нет чата'"
        :disabled="!current"
        spellcheck="false"
        @keydown.stop="onKey"
      ></textarea>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-32 tw:h-32 tw:p-0 tw:border-0 tw:rounded-full tw:bg-accent tw:text-on-accent tw:disabled:opacity-40" title="Отправить (Enter)" :disabled="!current || !text.trim() || sending" @click="chat.send()"><Icon name="send" :size="13" /></button>
    </div>
  </div>
</template>
