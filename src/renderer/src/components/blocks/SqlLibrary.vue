<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { SqlTemplate } from '@shared/sql'
import { placeFloat, useAnchor } from '../../lib/floating'
import { connWhere, dbConns, kindTitle, loadConns } from '../../lib/sqlDb'
import Icon from '../Icon.vue'

/**
 * «Из библиотеки»: every query of the notebook (each ```sql db=… block, a note of queries too) by folder and note —
 * its title, its connection, the database kind and host; a search over all of it. Picked — the block takes its text
 * and connection.
 */
const props = defineProps<{ self?: { path: string; line: number } }>()
const emit = defineEmits<{ pick: [t: SqlTemplate] }>()
const open = ref(false)
const btn = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
const list = shallowRef<SqlTemplate[]>([])
const q = ref('')
const input = ref<HTMLInputElement>()
useAnchor(open, btn, () => {
  if (!btn.value) return
  const f = placeFloat(btn.value, 560, true, 0)
  style.value = { ...f.style, maxHeight: `${Math.max(240, f.maxH)}px` }
})
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
const onDoc = (e: MouseEvent) => {
  const t = e.target as Node
  if (open.value && !btn.value?.contains(t) && !(t as Element).closest?.('.sqll-pop')) open.value = false
}
document.addEventListener('mousedown', onDoc, true)
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc, true))
</script>

<template>
  <button ref="btn" class="pill" :class="{ on: open }" title="Взять запрос из блокнота: из любой заметки, по папкам" @mousedown.prevent @click="toggle"><Icon name="book" :size="12" />библиотека</button>
  <Teleport to="body">
    <div v-if="open" class="sqll-pop" :style="style" @keydown.esc="open = false">
      <div class="sqll-head">
        <input ref="input" v-model="q" placeholder="Поиск: название, таблица, база, хост…" spellcheck="false" />
        <span class="muted">{{ total }}</span>
      </div>
      <div class="sqll-list">
        <p v-if="!total" class="muted empty">{{ list.length ? 'Ничего не найдено' : 'В блокноте пока нет запросов к БД. Любой блок «@бд» станет здесь шаблоном; можно завести заметку с запросами.' }}</p>
        <template v-for="g in groups" :key="g.folder">
          <div class="folder"><Icon name="folder" :size="12" />{{ g.folder }}</div>
          <template v-for="n in g.notes" :key="n.note">
            <div class="note">{{ n.note }}</div>
            <button v-for="t in n.items" :key="`${t.path}:${t.line}`" class="item" :title="t.sql" @click="pick(t)">
              <b>{{ t.title }}</b>
              <span class="meta"
                ><span class="db">{{ t.db || 'без подключения' }}</span
                ><template v-if="connOf(t.db)"> · {{ kindTitle(connOf(t.db)!.kind) }} · {{ connWhere(connOf(t.db)) }}</template
                ><template v-else-if="t.db"> · нет такого подключения</template></span
              >
            </button>
          </template>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  white-space: nowrap;
}
.pill.on,
.pill:hover {
  border-color: var(--accent);
  color: var(--text);
}
.sqll-pop {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-2);
  border-radius: 8px;
  background: var(--bg-2, var(--bg));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  font-size: 12.5px;
}
.sqll-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
.sqll-head input {
  flex: 1;
  height: 26px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.muted {
  color: var(--muted);
}
.sqll-list {
  overflow-y: auto;
  padding: 4px 0 8px;
}
.empty {
  margin: 8px 12px;
  white-space: normal;
}
.folder {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 2px;
  color: var(--text-2);
  font-weight: 600;
  white-space: nowrap;
}
.note {
  padding: 2px 12px 2px 30px;
  overflow: hidden;
  color: var(--muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 1px;
  padding: 4px 12px 4px 40px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.item:hover {
  background: var(--hover);
}
.item b,
.meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item b {
  font-weight: 500;
}
.meta {
  color: var(--muted);
  font-size: 11.5px;
}
.meta .db {
  color: var(--accent);
}
</style>
