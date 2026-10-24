<script setup lang="ts">
/**
 * «Комментарии» of a shared note: the open (or solved) ones in the order of the text, each — its place quoted, its
 * last word; a discussion opened — its messages, an answer, «Решено» / «Открыть снова», «К тексту»; a new one on the
 * selected text («Комментировать» of the editor's menu). Opened from the text too (a comment's mark).
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { unreadOf } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { showRoom, watchRoom } from '@renderer/lib/chat'
import ChatThread from '@nb/blocks/chat/ChatThread.vue'
import { addComment, canComment, closeComments, commentsOf, commentUi, gotoComment, openComment, resolveComment, type NoteComment } from '@nb/workspace/noteComments'
import { sharedDocOfPath } from '@nb/workspace/sharedDocs'

const props = defineProps<{ path: string }>()
const btn = ref<HTMLElement>()
const shared = computed(() => !!sharedDocOfPath(props.path))
const all = computed(() => commentsOf(props.path))
const showSolved = ref(false)
const shown = computed(() => all.value.filter((c) => !!c.room.resolved === showSolved.value))
const openCount = computed(() => all.value.filter((c) => !c.room.resolved).length)
const mayWrite = computed(() => canComment(props.path))

const open = computed({
  get: () => commentUi.path === props.path,
  set: (on) => (on ? Object.assign(commentUi, { path: props.path, mode: 'list', room: undefined, draft: undefined }) : closeComments()),
})
const current = computed<NoteComment | undefined>(() => all.value.find((c) => c.room.id === commentUi.room))
// a discussion shown: its messages loaded, read while it is open
let watched = ''
watch(
  () => (open.value && commentUi.mode === 'thread' ? commentUi.room : ''),
  (room) => {
    if (watched) watchRoom(watched, false)
    watched = room ?? ''
    if (!watched) return
    watchRoom(watched, true)
    void showRoom(watched).catch(() => undefined)
  },
)
onBeforeUnmount(() => watched && watchRoom(watched, false))

const draft = ref('')
const busy = ref(false)
const error = ref('')
async function create(): Promise<void> {
  const d = commentUi.draft
  if (!d || !draft.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const room = await addComment(props.path, d.from, d.to, draft.value)
    draft.value = ''
    openComment(props.path, room.id)
  } catch (e) {
    error.value = remoteError(e)
  } finally {
    busy.value = false
  }
}
async function resolve(c: NoteComment): Promise<void> {
  error.value = ''
  await resolveComment(c.room.id, !c.room.resolved).catch((e) => (error.value = remoteError(e)))
}
const lastLine = (c: NoteComment) => (c.room.last ? `${c.room.last.author.name}: ${c.room.last.text}` : '')
</script>

<template>
  <span v-if="shared" ref="btn" class="tw:inline-flex">
    <button
      class="tw:inline-flex tw:items-center tw:justify-center tw:gap-3 tw:min-w-28 tw:h-28 tw:px-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[&.on]:text-accent-fg"
      :class="{ on: openCount > 0 }"
      :title="openCount ? `Комментарии: открытых ${openCount}` : 'Комментарии (выделите текст → правая кнопка → «Комментировать»)'"
      @click="open = !open"
    >
      <Icon name="chat" :size="14" /><span v-if="openCount" class="tw:text-[11px] tw:font-data">{{ openCount }}</span>
    </button>
    <Popover v-model:open="open" :anchor="btn" :width="380" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-10 tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
      <!-- a new comment on the selected text -->
      <template v-if="commentUi.mode === 'new' && commentUi.draft">
        <b class="tw:text-text-hi tw:text-[13px]">Новый комментарий</b>
        <div class="tw:py-4 tw:px-10 tw:border-l-2 tw:border-l-accent tw:text-text-2 tw:italic tw:leading-[1.5]"><span class="tw:line-clamp-3 tw:wrap-anywhere">{{ commentUi.draft.quote }}</span></div>
        <textarea v-model="draft" class="tw:min-h-72 tw:py-6 tw:px-8 tw:resize-y tw:text-[13px]" placeholder="Что сказать об этом месте" @keydown.ctrl.enter.prevent="create"></textarea>
        <div class="tw:flex tw:gap-8">
          <button class="primary tw:h-30" :disabled="busy || !draft.trim()" @click="create">Комментировать</button>
          <button class="tw:h-30" @click="open = false">Отмена</button>
        </div>
      </template>

      <!-- one discussion -->
      <template v-else-if="commentUi.mode === 'thread' && current">
        <div class="tw:flex tw:items-center tw:gap-8">
          <button class="tw:inline-flex tw:items-center tw:gap-4 tw:h-30" @click="commentUi.mode = 'list'"><Icon name="chevronLeft" :size="12" />Все</button>
          <span class="tw:flex-1"></span>
          <button v-if="current.at && !current.at.gone" class="tw:h-30" title="Показать это место в тексте" @click="gotoComment(path, current)">К тексту</button>
          <button v-if="mayWrite" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-30" @click="resolve(current)"><Icon :name="current.room.resolved ? 'repeat' : 'check'" :size="12" />{{ current.room.resolved ? 'Открыть снова' : 'Решено' }}</button>
        </div>
        <div class="tw:py-4 tw:px-10 tw:border-l-2 tw:text-text-2 tw:italic tw:leading-[1.5]" :class="current.at?.gone ? 'tw:border-l-border-2 tw:line-through' : 'tw:border-l-accent'"><span class="tw:line-clamp-3 tw:wrap-anywhere">{{ current.room.anchor?.quote }}</span></div>
        <span v-if="current.at?.gone" class="tw:text-muted">Текст удалён — комментарий остался</span>
        <ChatThread :room="current.room.id" :readonly="!mayWrite" />
      </template>

      <!-- the list -->
      <template v-else>
        <div class="tw:flex tw:items-center tw:gap-8">
          <b class="tw:flex-1 tw:text-text-hi tw:text-[13px]">Комментарии</b>
          <span class="tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
            <button class="tw:h-26 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !showSolved }" @click="showSolved = false">Открытые</button>
            <button class="tw:h-26 tw:px-8 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: showSolved }" @click="showSolved = true">Решённые</button>
          </span>
        </div>
        <p v-if="!shown.length" class="tw:m-0 tw:text-muted">{{ showSolved ? 'Решённых нет' : 'Открытых нет. Выделите текст → правая кнопка → «Комментировать».' }}</p>
        <div class="tw:flex tw:flex-col tw:gap-4 tw:max-h-[50vh] tw:overflow-y-auto">
          <button v-for="c in shown" :key="c.room.id" class="tw:flex tw:flex-col tw:items-stretch tw:gap-3 tw:h-auto tw:py-6 tw:px-8 tw:text-left tw:border-0 tw:rounded-r2 tw:bg-transparent tw:hover:bg-hover" @click="openComment(path, c.room.id)">
            <span class="tw:flex tw:items-center tw:gap-6 tw:min-w-0">
              <span class="tw:flex-1 tw:min-w-0 tw:truncate tw:leading-[1.5] tw:text-text-2 tw:italic" :class="{ 'tw:line-through': c.at?.gone }">«{{ c.room.anchor?.quote }}»</span>
              <b v-if="unreadOf(c.room)" class="tw:min-w-18 tw:h-18 tw:px-5 tw:rounded-[9px] tw:bg-accent tw:text-white tw:text-[11px] tw:leading-[18px] tw:text-center">{{ unreadOf(c.room) }}</b>
            </span>
            <span class="tw:truncate tw:text-text">{{ lastLine(c) }}</span>
          </button>
        </div>
      </template>
      <span v-if="error" class="tw:text-down-fg">{{ error }}</span>
    </Popover>
  </span>
</template>
