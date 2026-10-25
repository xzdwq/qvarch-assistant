<script setup lang="ts">
/**
 * The chat's paperclip: files from this computer (pictures shown right in the chat), or a note / a folder of the
 * notebook — sent as one file (its export; the one who gets it puts it into their notebook in a click).
 */
import { computed, nextTick, ref } from 'vue'
import type { VaultNode } from '@shared/vault'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { loadTree, tree } from '@nb/workspace/vaultTreeStore'

defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ files: [files: FileList]; notes: [rel: string, withRuns: boolean] }>()
const btn = ref<HTMLElement>()
const open = ref(false)
/** What the menu shows: the two ways, or the notebook's notes and folders to pick. */
const view = ref<'ways' | 'notebook'>('ways')
const q = ref('')
const withRuns = ref(false)
const search = ref<HTMLInputElement>()
const picker = ref<HTMLInputElement>()

function toggle(): void {
  open.value = !open.value
  view.value = 'ways'
}
function fromComputer(): void {
  open.value = false
  picker.value?.click()
}
function onPicked(e: Event): void {
  const el = e.target as HTMLInputElement
  if (el.files?.length) emit('files', el.files)
  el.value = ''
}
async function fromNotebook(): Promise<void> {
  view.value = 'notebook'
  q.value = ''
  if (!tree.value.length) await loadTree()
  await nextTick()
  search.value?.focus()
}
/** The notebook's folders and notes (boards too) — each with its path; dot folders left out. */
const items = computed(() => {
  const out: VaultNode[] = []
  const walk = (ns: VaultNode[]) => ns.forEach((n) => (n.name.startsWith('.') ? undefined : (out.push(n), n.dir && walk(n.children ?? []))))
  walk(tree.value)
  const w = q.value.trim().toLowerCase()
  return (w ? out.filter((n) => n.path.toLowerCase().includes(w)) : out).slice(0, 200)
})
function pick(n: VaultNode): void {
  open.value = false
  emit('notes', n.path, withRuns.value)
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex tw:flex-none">
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:[&.on]:text-text" :class="{ on: open }" title="Приложить: файлы с этого компьютера или документ / папку из Блокнота (файлы можно вставить Ctrl+V или перетащить сюда)" :disabled="disabled" @click="toggle"><Icon name="paperclip" :size="16" /></button>
    <input ref="picker" type="file" multiple hidden @change="onPicked" />
    <Popover v-model:open="open" :anchor="btn" :width="view === 'ways' ? 240 : 340" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-2 tw:p-6 tw:border tw:border-border-2 tw:rounded-[14px] tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
      <template v-if="view === 'ways'">
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover" @click="fromComputer"><Icon name="upload" :size="13" />С этого компьютера</button>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover" @click="fromNotebook"><Icon name="notebook" :size="13" />Из Блокнота<Icon name="chevronRight" :size="11" class="tw:ml-auto tw:text-muted" /></button>
      </template>
      <template v-else>
        <div class="tw:flex tw:items-center tw:gap-6 tw:px-4 tw:pb-4">
          <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text" title="Назад" @click="view = 'ways'"><Icon name="chevronLeft" :size="13" /></button>
          <input ref="search" v-model="q" class="tw:flex-1 tw:min-w-0 tw:h-28" placeholder="Документ или папка" spellcheck="false" />
        </div>
        <div class="tw:flex tw:flex-col tw:max-h-300 tw:overflow-y-auto">
          <button v-for="n in items" :key="n.path" class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover" :title="n.path" @click="pick(n)">
            <Icon :name="n.dir ? 'folder' : 'note'" :size="13" class="tw:flex-none tw:text-muted" />
            <span class="tw:min-w-0 tw:truncate">{{ n.name }}</span>
            <span class="tw:min-w-0 tw:ml-auto tw:truncate tw:text-dim tw:text-[11px]">{{ n.path.split('/').slice(0, -1).join(' / ') }}</span>
          </button>
          <span v-if="!items.length" class="tw:p-8 tw:text-muted">Ничего не найдено</span>
        </div>
        <label class="tw:flex tw:items-center tw:gap-6 tw:pt-4 tw:px-8 tw:text-muted tw:text-[12px]"><input v-model="withRuns" type="checkbox" />с результатами запусков</label>
      </template>
    </Popover>
  </span>
</template>
