<script setup lang="ts">
/**
 * A chat's head: its title (its maker renames it right here), its people, its settings (ChatSettingsMenu: its sound,
 * whether the others may call one's AI), «Добавить» — a person one shares a chat or a shared note with; one with a main
 * conversation already — «Новая ветка» (this chat becomes its branch) or «Продолжить общую» (the main one goes on here).
 */
import { computed, nextTick, ref } from 'vue'
import { TITLE_MAX, type ChatRoom } from '@shared/transport/chat'
import { useEscLayer } from '@renderer/lib/usePopover'
import type { DeviceInfo } from '@shared/transport/protocol'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { chatMe, chatOnline, isHeld, roomOf } from '@renderer/lib/chat'
import { addPerson, chatPeople, mainWith, renameChat } from '@renderer/lib/chatActions'
import ChatAgentsMenu from './ChatAgentsMenu.vue'
import ChatSettingsMenu from './ChatSettingsMenu.vue'

/** `folded` — only this head is shown (its `unread` count beside the title); not given — it does not fold (the feed). */
const props = withDefaults(defineProps<{ room: ChatRoom; folded?: boolean; unread?: number }>(), { folded: undefined, unread: 0 })
const emit = defineEmits<{ switched: [room: string]; fold: [on: boolean] }>()
const mineToName = computed(() => props.room.createdBy === chatMe.value)
/** A chat of people (not a shared note's, not a comment): people may be added to it. */
const addable = computed(() => !props.room.space && !props.room.doc)
/** A chat kept on this computer only: renamed and given agents here; a person added — it goes to the server. */
const local = computed(() => isHeld(props.room.id))
/** Renaming — here or on the server (connected); adding people — the server's. */
const live = computed(() => local.value || chatOnline.value)
const canAdd = computed(() => chatOnline.value)
const offlineWhy = 'Нужен сервер: человек добавляется через него (чат перейдёт на сервер со всей историей)'
const error = ref('')
const fail = (e: unknown) => (error.value = remoteError(e))

// ---------- the title (Esc — as it was, wherever the focus is) ----------
const naming = ref(false)
const title = ref('')
const nameInput = ref<HTMLInputElement>()
useEscLayer(naming, () => (naming.value = false))
async function startNaming(): Promise<void> {
  title.value = props.room.title
  naming.value = true
  await nextTick()
  nameInput.value?.select()
}
async function rename(): Promise<void> {
  // (Esc took it back already: the blur that follows changes nothing)
  if (!naming.value) return
  naming.value = false
  const t = title.value.trim()
  if (t && t !== props.room.title) await renameChat(props.room.id, t).catch(fail)
}

// ---------- people ----------
const addBtn = ref<HTMLElement>()
const adding = ref(false)
const people = ref<DeviceInfo[]>([])
/** The person picked whose main conversation exists: the choice of how to go on. */
const asking = ref<{ who: DeviceInfo; main: ChatRoom }>()
async function openAdding(): Promise<void> {
  adding.value = !adding.value
  asking.value = undefined
  error.value = ''
  if (adding.value) people.value = (await chatPeople().catch((e) => (fail(e), []))).filter((d) => !props.room.members.some((m) => m.id === d.id))
}
async function pick(d: DeviceInfo): Promise<void> {
  const main = await mainWith(d.id).catch(() => null)
  if (main && main.id !== props.room.id) asking.value = { who: d, main }
  else await add(d, 'branch')
}
async function add(d: DeviceInfo, as: 'branch' | 'main'): Promise<void> {
  try {
    const r = await addPerson(props.room.id, d.id, as)
    adding.value = false
    asking.value = undefined
    if (r.id !== props.room.id) emit('switched', r.id)
  } catch (e) {
    fail(e)
  }
}
const parentTitle = computed(() => (props.room.parent ? roomOf(props.room.parent)?.title : undefined))
</script>

<template>
  <div class="tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:text-[12.5px] tw:whitespace-nowrap">
    <span v-if="folded === undefined" class="tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:text-muted"><Icon name="chat" :size="14" /></span>
    <button v-else class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-2 tw:w-auto tw:h-24 tw:py-0 tw:px-4 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" :title="folded ? 'Развернуть чат' : 'Свернуть чат (останется заголовок)'" @click="emit('fold', !folded)">
      <Icon :name="folded ? 'chevronRight' : 'chevronDown'" :size="13" /><Icon name="chat" :size="14" />
    </button>
    <span v-if="folded && unread" class="tw:flex-none tw:min-w-18 tw:h-18 tw:px-5 tw:rounded-full tw:bg-accent tw:text-on-accent tw:text-[10.5px] tw:font-bold tw:leading-18 tw:text-center" :title="`Непрочитанных: ${unread}`">{{ unread }}</span>
    <input v-if="naming" ref="nameInput" v-model="title" class="tw:h-26 tw:min-w-0 tw:flex-1 tw:px-10 tw:rounded-full tw:text-[13px]" :maxlength="TITLE_MAX" @keydown.enter.prevent="rename" @blur="rename" />
    <template v-else>
      <b class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-hi">{{ room.title }}</b>
      <button v-if="mineToName" class="tw:inline-flex tw:flex-none tw:w-22 tw:h-22 tw:p-0 tw:items-center tw:justify-center tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:enabled:text-text" :disabled="!live" :title="live ? 'Переименовать' : 'Нужен сервер'" @click="startNaming"><Icon name="pencil" :size="12" /></button>
    </template>
    <span v-if="parentTitle" class="tw:flex-none tw:px-6 tw:rounded-full tw:bg-white/8 tw:text-muted tw:text-[11px]" :title="`Ветка разговора «${parentTitle}»`">↳ {{ parentTitle }}</span>
    <span class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-muted">{{ room.members.map((m) => m.name).join(', ') }}</span>
    <span class="tw:flex-1"></span>
    <ChatSettingsMenu :room="room" :live="live" :local="local" />
    <ChatAgentsMenu v-if="!room.anchor" :room="room" :live="live" />
    <span v-if="addable" ref="addBtn" class="tw:inline-flex tw:flex-none">
      <button class="tw:inline-flex tw:items-center tw:gap-4 tw:h-26 tw:py-0 tw:px-10 tw:rounded-full" :disabled="!canAdd" :title="canAdd ? (local ? 'Добавить человека — чат перейдёт на сервер со всей историей' : 'Добавить человека в чат') : offlineWhy" @click="openAdding"><Icon name="userPlus" :size="13" />Добавить</button>
    </span>
    <Popover v-model:open="adding" :anchor="addBtn" :width="300" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-6 tw:p-10 tw:border tw:border-border-2 tw:rounded-[14px] tw:bg-pop tw:shadow-pop tw:text-[12.5px] tw:whitespace-normal">
      <template v-if="asking">
        <span>С {{ asking.who.name }} уже есть разговор «{{ asking.main.title }}». Как продолжить?</span>
        <button class="primary tw:h-30 tw:py-0 tw:rounded-full" @click="add(asking.who, 'branch')">Новая ветка</button>
        <button class="tw:h-30 tw:py-0 tw:rounded-full" title="Этот чат уступит место общему разговору — в блоке будет он" @click="add(asking.who, 'main')">Продолжить общую ветку</button>
      </template>
      <template v-else>
        <span class="tw:text-muted">Люди, с которыми у вас общие чаты или заметки</span>
        <button v-for="d in people" :key="d.id" class="tw:flex tw:items-center tw:h-30 tw:py-0 tw:px-10 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-left tw:hover:bg-hover" @click="pick(d)">{{ d.name }}</button>
        <span v-if="!people.length" class="tw:text-muted">Пока никого — поделитесь заметкой, и её участники появятся здесь</span>
      </template>
      <span v-if="error" class="tw:text-down-fg">{{ error }}</span>
    </Popover>
  </div>
</template>
