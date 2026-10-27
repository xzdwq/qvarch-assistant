<script setup lang="ts">
/**
 * A file a message carries: a picture shown right here (a click — full size; Esc / a click closes), any other file —
 * its name, size, «save»; a note / a folder of someone's notebook — «В блокнот» puts it into this one.
 */
import { ref, watch } from 'vue'
import type { ChatFile } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import { chatFileUrl, isNotesFile, saveChatFile, sizeText } from '@renderer/lib/chatFileView'
import { useEscLayer } from '@renderer/lib/usePopover'
import { useChatPort } from './chatPort'

const props = defineProps<{ file: ChatFile; picture: boolean; room: string }>()
const chat = useChatPort()
const chatOnline = chat.online
const url = ref('')
const said = ref('')
// a picture: fetched once (no connection — the moment it is back)
watch(
  () => [props.picture ? props.file.id : undefined, chatOnline.value] as const,
  ([id], before) => {
    if (id !== before?.[0]) url.value = ''
    if (url.value || !props.picture) return
    said.value = ''
    void chatFileUrl(props.room, props.file).then((u) => (url.value = u), (e) => (said.value = remoteError(e)))
  },
  { immediate: true },
)
const full = ref(false)
useEscLayer(full, () => (full.value = false))
async function save(): Promise<void> {
  said.value = ''
  await saveChatFile(props.room, props.file).catch((e) => (said.value = remoteError(e)))
}
/** A note / a folder put into this notebook (at its top), then opened. */
const adding = ref(false)
async function toNotebook(): Promise<void> {
  adding.value = true
  said.value = ''
  try {
    said.value = await chat.takeNotes(props.room, props.file)
  } catch (e) {
    said.value = remoteError(e)
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div v-if="picture" class="tw:group/img tw:relative tw:mt-2 tw:max-w-full">
    <img v-if="url" :src="url" alt="" class="tw:block tw:max-w-full tw:max-h-280 tw:rounded-[8px] tw:cursor-zoom-in" :title="file.name" @click="full = true" />
    <span v-else class="tw:inline-flex tw:items-center tw:gap-6 tw:h-40 tw:px-10 tw:text-muted tw:text-[12px]"><Icon name="image" :size="14" />{{ said || 'Загружается…' }}</span>
    <button v-if="url" class="tw:absolute tw:top-6 tw:right-6 tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-(--image-tool-bg) tw:text-(--image-tool-fg) tw:opacity-0 tw:group-hover/img:opacity-100" title="Сохранить" @click="save"><Icon name="download" :size="13" /></button>
    <Teleport to="body">
      <div v-if="full" class="qa-lightbox" @click="full = false"><img :src="url" alt="" /></div>
    </Teleport>
  </div>
  <div v-else class="tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:mt-2 tw:py-6 tw:px-8 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg/60">
    <Icon :name="isNotesFile(file) ? 'notebook' : 'file'" :size="18" class="tw:flex-none tw:text-muted" />
    <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1">
      <span class="tw:truncate tw:text-[12.5px] tw:text-text" :title="file.name">{{ file.name }}</span>
      <span class="tw:text-muted tw:text-[11px]">{{ said || (isNotesFile(file) ? `Из Блокнота · ${sizeText(file.size)}` : sizeText(file.size)) }}</span>
    </span>
    <button v-if="isNotesFile(file)" class="tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-28 tw:py-0 tw:px-8 tw:text-[12px]" title="Добавить в свой Блокнот (документ или папку целиком) и открыть" :disabled="adding" @click="toNotebook"><Icon name="notebook" :size="12" />{{ adding ? 'Добавляю…' : 'В блокнот' }}</button>
    <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0" title="Сохранить" @click="save"><Icon name="download" :size="13" /></button>
  </div>
</template>
