<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { VaultNode } from '@shared/vault'
import { besidePlace } from '../lib/usePopover'
import Icon from './Icon.vue'
import Popover from './Popover.vue'
import { ensureMentions, notesOf, noteTitle, openNote } from '../lib/mentions'

/**
 * The notes an event is mentioned in: a link icon with their count; a click — the list (the note's name, when it
 * was made), a note opened from it. Nothing when no note mentions the event.
 */
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ opened: [] }>()
ensureMentions()
const paths = computed(() => notesOf(props.id))
const open = ref(false)
/** The chip it opened from: the list stays by it, closes when it is out of sight. */
const anchor = ref<HTMLElement>()
const place = besidePlace(300, 260)
const ctimes = shallowRef<Map<string, number>>(new Map())
async function toggle(e: Event): Promise<void> {
  if (open.value) return void (open.value = false)
  anchor.value = e.currentTarget as HTMLElement
  open.value = true
  // when each note was made (the vault's tree)
  const map = new Map<string, number>()
  const walk = (ns: VaultNode[]) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : map.set(n.path, n.ctime)))
  walk(await window.qa.vaultTree())
  ctimes.value = map
}
const when = (p: string) => {
  const t = ctimes.value.get(p)
  return t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}
function go(p: string): void {
  open.value = false
  void openNote(p)
  emit('opened')
}
</script>

<template>
  <span v-if="paths.length" class="nlx tw:inline-flex tw:flex-none tw:items-center tw:gap-3 tw:h-20 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[10px] tw:bg-transparent tw:text-text-2 tw:text-[11px] tw:cursor-pointer tw:hover:not-[&.on]:border-accent tw:[&.on]:border-accent tw:hover:not-[&.on]:text-accent-fg tw:[&.on]:text-accent-fg" role="button" tabindex="0" :class="{ on: open }" :title="`Упомянуто в заметках: ${paths.length}`" @click.stop="toggle" @keydown.enter.stop="toggle" @pointerdown.stop @mousedown.stop>
    <Icon name="link" :size="12" /><b class="tw:font-semibold">{{ paths.length }}</b>
  </span>
  <Popover v-model:open="open" :anchor="anchor" :place="place" class="nlx-pop tw:fixed tw:z-3000 tw:flex tw:flex-col tw:gap-1 tw:w-290 tw:max-h-320 tw:p-6 tw:overflow-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" @pointerdown.stop @click.stop>
    <p class="cap tw:mt-2 tw:mr-6 tw:mb-6 tw:ml-6 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">Упомянуто в заметках</p>
    <button class="tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text tw:text-[13px] tw:text-left tw:hover:bg-hover" v-for="p in paths" :key="p" @click="go(p)">
      <Icon name="note" :size="13" />
      <span class="t tw:flex tw:flex-1 tw:flex-col tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ noteTitle(p) }}<small class="tw:overflow-hidden tw:text-muted tw:text-[11px] tw:text-ellipsis" v-if="p.includes('/')">{{ p.split('/').slice(0, -1).join(' / ') }}</small></span>
      <span class="d tw:flex-none tw:text-muted tw:text-[11.5px]">{{ when(p) }}</span>
    </button>
  </Popover>
</template>
