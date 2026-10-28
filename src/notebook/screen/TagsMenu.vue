<script setup lang="ts">
/**
 * «Теги и граф»: the notebook's graph opened from its first line; below — every tag of the notes with how many have
 * it (nested ones under their parents' names): one picked filters the tree by it (picked again — the filter off).
 * A field narrows a long list. Read when opened.
 */
import { computed, nextTick, ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { layout } from '@nb/workspace/paneLayout'
import { filterByTag } from '@nb/workspace/tagFilter'

const emit = defineEmits<{ graph: [] }>()
const btn = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const open = ref(false)
const q = ref('')
const tags = ref<Array<{ name: string; label: string; count: number }>>()
const shown = computed(() => {
  const w = q.value.trim().replace(/^#/, '').toLowerCase()
  return (tags.value ?? []).filter((t) => !w || t.name.includes(w)).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
})
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  q.value = ''
  tags.value = undefined
  tags.value = await window.qa.vaultTags().catch(() => [])
  await nextTick()
  input.value?.focus()
}
function pick(name: string): void {
  filterByTag(name)
  open.value = false
}
/** A nested tag — shifted under its parent's place by its depth. */
const depthOf = (name: string) => name.split('/').length - 1
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:bg-white/7 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" :class="{ on: open || !!layout.tag }" :title="layout.tag ? `Теги и граф — фильтр: #${layout.tag}` : 'Теги и граф блокнота'" @click="toggle"><Icon name="tag" :size="15" /></button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="260" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-2 tw:max-h-[min(440px,70vh)] tw:p-6 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
    <button class="tw:flex tw:flex-none tw:items-center tw:gap-6 tw:h-28 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text tw:whitespace-nowrap tw:hover:bg-hover" title="Все заметки и их связи: ссылки, теги, таблицы, запросы" @click="(open = false), emit('graph')"><Icon name="branch" :size="13" /><span class="tw:min-w-0 tw:truncate">Граф блокнота</span></button>
    <span class="tw:flex-none tw:h-1 tw:my-3 tw:bg-border"></span>
    <input ref="input" v-model="q" class="tw:flex-none tw:h-26 tw:mb-4 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:bg-field tw:text-text tw:outline-none tw:focus:border-accent" placeholder="Найти тег" spellcheck="false" @keydown.enter.prevent="shown[0] && pick(shown[0].name)" />
    <div class="tw:flex tw:flex-col tw:gap-1 tw:min-h-0 tw:overflow-y-auto">
      <span v-if="!tags" class="tw:px-6 tw:text-muted">Ищу…</span>
      <span v-else-if="!tags.length" class="tw:px-6 tw:text-muted">Тегов нет — напишите #тег в заметке</span>
      <span v-else-if="!shown.length" class="tw:px-6 tw:text-muted">Нет такого тега</span>
      <button v-for="t in shown" :key="t.name" class="tw:flex tw:flex-none tw:items-center tw:gap-6 tw:h-26 tw:pr-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text tw:whitespace-nowrap tw:hover:not-[&.on]:bg-hover tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg" :class="{ on: layout.tag === t.name }" :style="{ paddingLeft: `${6 + depthOf(t.name) * 12}px` }" :title="layout.tag === t.name ? 'Снять фильтр' : `Показать заметки с #${t.label}`" @click="pick(t.name)">
        <span class="tw:min-w-0 tw:truncate">#{{ t.label }}</span><span class="tw:flex-1"></span><span class="tw:flex-none tw:text-muted tw:text-[11px]">{{ t.count }}</span>
      </button>
    </div>
  </Popover>
</template>
