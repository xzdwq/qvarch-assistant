<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { SqlTemplate } from '@shared/sql'
import { connWhere, dbConns, kindTitle, loadConns } from '@renderer/lib/sqlDb'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'

/**
 * «Из библиотеки»: every query of the notebook (each ```sql db=… block, a note of queries too) by folder and note —
 * its title, its connection, the database kind and host; a search over all of it. Picked — the block takes its text
 * and connection.
 */
const props = defineProps<{ self?: { path: string; line: number } }>()
const emit = defineEmits<{ pick: [t: SqlTemplate] }>()
const open = ref(false)
const btn = ref<HTMLElement>()
const list = shallowRef<SqlTemplate[]>([])
const q = ref('')
const input = ref<HTMLInputElement>()
/** (never lower than a few rows, even with little room) */
const fitHeight = (room: number) => Math.max(240, room)
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  void loadConns(true)
  list.value = await window.qa.sql('library')
  await nextTick()
  input.value?.focus()
}
const connOf = (name: string) => dbConns.value.find((c) => c.name === name)
/** By folder, then note; the search over the title, the text, the connection, its kind and host. */
const groups = computed(() => {
  const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = list.value.filter((t) => {
    if (props.self && t.path === props.self.path && t.line === props.self.line) return false
    const c = connOf(t.db)
    const hay = `${t.title} ${t.name ?? ''} ${t.sql} ${t.db} ${kindTitle(c?.kind)} ${connWhere(c)} ${t.path}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const by = new Map<string, Map<string, SqlTemplate[]>>()
  for (const t of shown) {
    const parts = t.path.split('/')
    const folder = parts.slice(0, -1).join(' / ') || 'Блокнот'
    const note = parts[parts.length - 1].replace(/\.md$/i, '')
    const f = by.get(folder) ?? new Map<string, SqlTemplate[]>()
    f.set(note, [...(f.get(note) ?? []), t])
    by.set(folder, f)
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([folder, notes]) => ({ folder, notes: [...notes.entries()].map(([note, items]) => ({ note, items })) }))
})
const total = computed(() => groups.value.reduce((n, g) => n + g.notes.reduce((m, x) => m + x.items.length, 0), 0))
function pick(t: SqlTemplate): void {
  emit('pick', t)
  open.value = false
}
</script>

<template>
  <button ref="btn" class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:not-hover:border-accent tw:hover:border-accent tw:[&.on]:not-hover:text-text tw:hover:text-text tw:hover:enabled:bg-hover" :class="{ on: open }" title="Взять запрос из блокнота: из любой заметки, по папкам" @mousedown.prevent @click="toggle"><Icon name="book" :size="12" />библиотека</button>
  <Popover v-model:open="open" :anchor="btn" :width="560" align-left :chrome="0" :max-height="fitHeight" class="sqll-pop tw:flex tw:flex-col tw:overflow-hidden tw:border tw:border-border-2 tw:rounded-[8px] tw:[background:var(--bg-2,var(--bg))] tw:[box-shadow:var(--sql-library-shadow)] tw:text-[12.5px]">
      <div class="sqll-head tw:flex tw:items-center tw:gap-8 tw:p-8 tw:border-b tw:border-b-border">
        <input class="tw:flex-1 tw:h-26 tw:min-w-0 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" ref="input" v-model="q" placeholder="Поиск: название, таблица, база, хост…" spellcheck="false" />
        <span class="muted tw:text-muted">{{ total }}</span>
      </div>
      <div class="sqll-list tw:overflow-y-auto tw:pt-4 tw:pr-0 tw:pb-8 tw:pl-0">
        <p v-if="!total" class="muted empty tw:text-muted tw:my-8 tw:mx-12 tw:whitespace-normal">{{ list.length ? 'Ничего не найдено' : 'В блокноте пока нет запросов к БД. Любой блок «@бд» станет здесь шаблоном; можно завести заметку с запросами.' }}</p>
        <template v-for="g in groups" :key="g.folder">
          <div class="folder tw:flex tw:items-center tw:gap-6 tw:pt-8 tw:pr-12 tw:pb-2 tw:pl-12 tw:text-text-2 tw:font-semibold tw:whitespace-nowrap"><Icon name="folder" :size="12" />{{ g.folder }}</div>
          <template v-for="n in g.notes" :key="n.note">
            <div class="note tw:pt-2 tw:pr-12 tw:pb-2 tw:pl-30 tw:overflow-hidden tw:text-muted tw:text-[11.5px] tw:text-ellipsis tw:whitespace-nowrap">{{ n.note }}</div>
            <button v-for="t in n.items" :key="`${t.path}:${t.line}`" class="item tw:flex tw:w-full tw:flex-col tw:gap-1 tw:pt-4 tw:pr-12 tw:pb-4 tw:pl-40 tw:border-0 tw:bg-transparent tw:text-text tw:text-left tw:hover:bg-hover tw:hover:enabled:border-border-3" :title="t.sql" @click="pick(t)">
              <b class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-medium">{{ t.title }}</b>
              <span class="meta tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]"
                ><span class="db tw:text-accent">{{ t.db || 'без подключения' }}</span
                ><template v-if="connOf(t.db)"> · {{ kindTitle(connOf(t.db)!.kind) }} · {{ connWhere(connOf(t.db)) }}</template
                ><template v-else-if="t.db"> · нет такого подключения</template></span
              >
            </button>
          </template>
        </template>
      </div>
  </Popover>
</template>
