<script setup lang="ts">
/**
 * «Лента»: every chat and discussion of this device — conversations (each with its branches; the main one shows them
 * all), the shared notes' chats, the comments — newest first, the unread counted; the one picked on the right with its
 * head and messages, answered right here. A comment — «В заметке» opens its note at its place.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { attachWord, authorName, feedSections, isComment, unreadOf, type ChatRoom } from '@shared/transport/chat'
import { notifiesIn } from '@shared/transport/constants'
import Icon from '@renderer/components/Icon.vue'
import { branchesOf, chatMe, chatOnline, chatPrefs, chatRooms, feedRoom, showRoom, watchRoom } from '@renderer/lib/chat'
import { openNote } from '@renderer/lib/mentions'
import ChatHeader from '../chat/ChatHeader.vue'
import ChatThread from '../chat/ChatThread.vue'
import RowsGrip from '../chat/RowsGrip.vue'
import { mayWriteIn } from '../chat/roomRights'
import { FEED_ROWS, ROW_PX, rowsOf, withRows } from '../chat/model'
import { openComment } from '@nb/workspace/noteComments'
import { pathOfShared } from '@nb/workspace/sharedAttachments'

const props = defineProps<{ src: string; onChange?: (src: string) => void }>()
/** The feed's height in lines: as the block keeps it; while its edge is dragged — as dragged. */
const rows = ref(rowsOf(props.src, FEED_ROWS))
watch(
  () => props.src,
  (s) => (rows.value = rowsOf(s, FEED_ROWS)),
)

const q = ref('')
const matches = (r: ChatRoom) => {
  const w = q.value.trim().toLowerCase()
  return !w || `${r.title} ${r.members.map((m) => m.name).join(' ')} ${r.last?.text ?? ''}`.toLowerCase().includes(w)
}
const sections = computed(() => feedSections(chatRooms.value.filter(matches)))
const picked = computed(() => chatRooms.value.find((r) => r.id === feedRoom.value))
// none picked yet: the newest one
watch(
  () => chatRooms.value.length,
  () => {
    if (picked.value) return
    const s = sections.value
    feedRoom.value = s.talks[0]?.room.id ?? s.shared[0]?.id ?? s.comments[0]?.id ?? ''
  },
  { immediate: true },
)
const also = computed(() => (picked.value ? branchesOf(picked.value.id).map((r) => r.id) : []))
// the one picked: loaded, read while shown
let watched = ''
watch(
  () => picked.value?.id ?? '',
  (id) => {
    if (watched) watchRoom(watched, false)
    watched = id
    if (!id) return
    watchRoom(id, true)
    void showRoom(id).catch(() => undefined)
  },
  { immediate: true },
)
onBeforeUnmount(() => watched && watchRoom(watched, false))

const snippet = (r: ChatRoom) => (r.last ? `${r.last.author.id === chatMe.value && !r.last.agent ? 'Вы' : authorName(r.last)}: ${r.last.text || (r.last.attach ? attachWord(r.last.attach) : '')}` : 'Нет сообщений')
const muted = (r: ChatRoom) => !notifiesIn(chatPrefs.value, r.id)
/** A comment's note opened at its place. */
async function toNote(r: ChatRoom): Promise<void> {
  const path = r.doc ? pathOfShared(r.doc) : undefined
  if (!path) return
  await openNote(path)
  openComment(path, r.id)
}
</script>

<template>
  <div class="tw:flex tw:flex-col">
    <div class="tw:flex tw:border tw:border-border tw:rounded-[18px] tw:bg-panel tw:overflow-hidden" :style="{ height: `${rows * ROW_PX}px` }">
      <aside class="tw:flex tw:flex-col tw:flex-none tw:w-270 tw:border-r tw:border-r-border">
        <div class="tw:flex tw:items-center tw:gap-6 tw:h-40 tw:px-10 tw:border-b tw:border-b-border">
          <Icon name="search" :size="13" class="tw:text-muted" />
          <input v-model="q" class="tw:flex-1 tw:min-w-0 tw:h-28 tw:border-0 tw:bg-transparent" placeholder="Поиск по чатам" spellcheck="false" />
        </div>
        <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:py-4">
          <p v-if="!chatOnline && !chatRooms.length" class="tw:m-12 tw:text-muted tw:text-[12.5px]">Сервер не подключён — Настройки → Сервер и чат</p>
          <template v-for="(part, k) in [{ head: 'Разговоры', rows: sections.talks.flatMap((t) => [{ r: t.room, sub: false }, ...t.branches.map((b) => ({ r: b, sub: true }))]) }, { head: 'Общие заметки', rows: sections.shared.map((r) => ({ r, sub: false })) }, { head: 'Комментарии', rows: sections.comments.map((r) => ({ r, sub: false })) }]" :key="k">
            <div v-if="part.rows.length" class="tw:px-12 tw:pt-8 tw:pb-2 tw:text-muted tw:text-[10.5px] tw:font-semibold tw:uppercase tw:tracking-[0.06em]">{{ part.head }}</div>
            <button
              v-for="row in part.rows"
              :key="row.r.id"
              class="tw:flex tw:flex-col tw:items-stretch tw:gap-1 tw:w-full tw:h-auto tw:py-6 tw:pr-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-left tw:hover:bg-hover tw:[&.on]:bg-accent/14"
              :class="[{ on: row.r.id === feedRoom }, row.sub ? 'tw:pl-26' : 'tw:pl-12']"
              @click="feedRoom = row.r.id"
            >
              <span class="tw:flex tw:items-center tw:gap-6 tw:min-w-0">
                <span v-if="row.sub" class="tw:text-muted">↳</span>
                <b class="tw:flex-1 tw:min-w-0 tw:truncate tw:text-text tw:text-[13px] tw:font-medium" :class="{ 'tw:italic': isComment(row.r) }">{{ row.r.title }}</b>
                <Icon v-if="muted(row.r)" name="bellOff" :size="11" class="tw:text-dim" />
                <b v-if="unreadOf(row.r)" class="tw:min-w-18 tw:h-18 tw:px-5 tw:rounded-[9px] tw:bg-accent tw:text-white tw:text-[11px] tw:leading-18 tw:text-center">{{ unreadOf(row.r) }}</b>
              </span>
              <span class="tw:truncate tw:text-muted tw:text-[12px]">{{ snippet(row.r) }}</span>
            </button>
          </template>
          <p v-if="chatOnline && !chatRooms.length" class="tw:m-12 tw:text-muted tw:text-[12.5px]">Чатов пока нет — наберите «@чат» в любой заметке</p>
        </div>
      </aside>
      <section class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0 tw:gap-6 tw:p-10">
        <template v-if="picked">
          <ChatHeader :room="picked" @switched="(id) => (feedRoom = id)" />
          <div v-if="isComment(picked)" class="tw:flex tw:items-center tw:gap-8 tw:text-[12px]">
            <span class="tw:flex-1 tw:min-w-0 tw:truncate tw:italic tw:text-text-2">«{{ picked.anchor?.quote }}»<template v-if="picked.resolved"> · решено</template></span>
            <button class="tw:h-26 tw:py-0 tw:px-10 tw:rounded-full" @click="toNote(picked)">В заметке</button>
          </div>
          <ChatThread :room="picked.id" :also="also" :readonly="!mayWriteIn(picked)" />
        </template>
        <p v-else class="tw:m-auto tw:text-muted tw:text-[13px]">Выберите чат слева</p>
      </section>
    </div>
    <RowsGrip :rows="rows" @drag="(n) => (rows = n)" @done="(n) => onChange?.(withRows(src, n))" />
  </div>
</template>
