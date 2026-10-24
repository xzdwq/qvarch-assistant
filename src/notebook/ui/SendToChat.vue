<script setup lang="ts">
/**
 * «В чат»: a block sent into a chat — the chats newest first (a word may go with it); the others see it as it was
 * here (a query's rows, a request's answer, a browser test as written), secrets taken off, a table cut to fit.
 */
import { computed, ref } from 'vue'
import { isComment, sortRooms } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { chatOnline, chatRooms } from '@renderer/lib/chat'
import { sendAttach } from '@renderer/lib/chatActions'
import { attachOf, sendsUnrun, type ShotKind } from '@nb/engine/chatAttach'
import type { BlockRun } from '@nb/engine'

const props = defineProps<{ kind: ShotKind; run?: BlockRun; src: string; title: string }>()
const btn = ref<HTMLElement>()
const open = ref(false)
const word = ref('')
const said = ref('')
const rooms = computed(() => sortRooms(chatRooms.value.filter((r) => !isComment(r))))
async function send(room: string, title: string): Promise<void> {
  said.value = ''
  const a = attachOf(props.kind, { run: props.run, src: props.src }, props.title)
  if (!a) return void (said.value = 'Нечего отправить — у результата нет данных')
  try {
    await sendAttach(room, a, word.value.trim())
    word.value = ''
    open.value = false
    said.value = `Отправлено в «${title}»`
    setTimeout(() => (said.value = ''), 2500)
  } catch (e) {
    said.value = remoteError(e)
  }
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex tw:items-center tw:gap-6">
    <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text" :disabled="!chatOnline" :title="!chatOnline ? 'Сервер не подключён' : sendsUnrun(kind) ? 'Отправить в чат — целиком, как написано' : 'Отправить результат в чат'" @mousedown.prevent @click="open = !open"><Icon name="send" :size="12" /></button>
    <span v-if="said && !open" class="tw:text-muted tw:text-[11.5px]">{{ said }}</span>
    <Popover v-model:open="open" :anchor="btn" :width="300" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-6 tw:p-10 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
      <b class="tw:text-text-hi">{{ sendsUnrun(kind) ? `«${title}» в чат` : `Результат «${title}» в чат` }}</b>
      <input v-model="word" class="tw:h-30" placeholder="Слово к нему (необязательно)" />
      <div class="tw:flex tw:flex-col tw:max-h-260 tw:overflow-y-auto">
        <button v-for="r in rooms" :key="r.id" class="tw:flex tw:flex-col tw:items-start tw:h-auto tw:py-5 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover" @click="send(r.id, r.title)">
          <span class="tw:w-full tw:truncate tw:text-text">{{ r.title }}</span>
          <span class="tw:w-full tw:truncate tw:text-muted tw:text-[11.5px]">{{ r.members.map((m) => m.name).join(', ') }}</span>
        </button>
        <span v-if="!rooms.length" class="tw:text-muted">Чатов нет — наберите «@чат» в заметке</span>
      </div>
      <span v-if="said" class="tw:text-down-fg">{{ said }}</span>
    </Popover>
  </span>
</template>
