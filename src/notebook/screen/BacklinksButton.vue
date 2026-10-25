<script setup lang="ts">
/** «Ссылаются сюда»: the notes whose [[links]] lead to this one (read when opened) — a click opens one. */
import { ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { dirOf, noteName } from '@nb/domain/notePaths'
import { openFile } from '@nb/workspace/paneLayout'

const props = defineProps<{ path: string }>()
const btn = ref<HTMLElement>()
const open = ref(false)
const list = ref<string[]>()
async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) list.value = await window.qa.vaultBacklinks(props.path).catch(() => [])
}
function go(p: string): void {
  open.value = false
  openFile(p)
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" :class="{ on: open }" title="Ссылаются сюда — заметки со ссылкой [[…]] на эту" @click="toggle"><Icon name="link" :size="14" /></button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="300" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-2 tw:p-8 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
    <span class="tw:px-4 tw:pb-4 tw:text-muted">Ссылаются сюда</span>
    <span v-if="!list" class="tw:px-4 tw:text-muted">Ищу…</span>
    <span v-else-if="!list.length" class="tw:px-4 tw:text-muted">Нет заметок со ссылкой на эту</span>
    <button v-for="p in list" :key="p" class="tw:flex tw:items-center tw:gap-6 tw:h-28 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover tw:whitespace-nowrap" :title="p" @click="go(p)">
      <Icon name="note" :size="12" /><span class="tw:min-w-0 tw:truncate">{{ noteName(p) }}</span><span class="tw:min-w-0 tw:truncate tw:text-muted tw:text-[11.5px]">{{ dirOf(p) }}</span>
    </button>
  </Popover>
</template>
