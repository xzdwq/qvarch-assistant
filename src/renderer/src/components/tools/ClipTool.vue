<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { ClipItem, ClipState } from '@shared/clip'
import Icon from '../Icon.vue'

/**
 * The clipboard's history: what was copied (anywhere), by day, newest first; a click puts it back on the
 * clipboard. Kept encrypted on this computer, the last 1000; password managers' copies are not kept.
 */
const state = shallowRef<ClipState>({ on: true, items: [] })
void window.qa.clipGet().then((s) => (state.value = s))
const off = window.qa.onClip((s) => (state.value = s))
onBeforeUnmount(off)
const q = ref('')
const shown = computed(() => {
  const w = q.value.trim().toLowerCase()
  return w ? state.value.items.filter((x) => x.text.toLowerCase().includes(w)) : state.value.items
})
const dayKey = (t: number) => new Date(t).toLocaleDateString('sv-SE')
const dayName = (k: string) => {
  const today = new Date().toLocaleDateString('sv-SE')
  const y = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE')
  return k === today ? 'Сегодня' : k === y ? 'Вчера' : new Date(`${k}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}
const groups = computed(() => {
  const m = new Map<string, ClipItem[]>()
  for (const x of shown.value) m.set(dayKey(x.at), [...(m.get(dayKey(x.at)) ?? []), x])
  return [...m].map(([k, items]) => ({ k, name: dayName(k), items }))
})
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const open = ref(new Set<string>())
const long = (t: string) => t.length > 280 || t.split('\n').length > 4
function toggle(id: string): void {
  const s = new Set(open.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  open.value = s
}
const copied = ref('')
async function copy(x: ClipItem): Promise<void> {
  await window.qa.clipCopy(x.id)
  copied.value = x.id
  setTimeout(() => copied.value === x.id && (copied.value = ''), 1200)
}
async function setOn(on: boolean): Promise<void> {
  state.value = await window.qa.clipSet(on)
}
function clearAll(): void {
  if (confirm(`Удалить всю историю буфера обмена (${state.value.items.length})?`)) void window.qa.clipClear()
}
</script>

<template>
  <div class="cl tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-14 tw:h-38 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-14 tw:border-b tw:border-b-border tw:whitespace-nowrap">
      <label class="sw tw:inline-flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px] tw:cursor-pointer" :title="state.on ? 'История ведётся' : 'История не ведётся'"><input class="tw:hidden" type="checkbox" :checked="state.on" @change="setOn(($event.target as HTMLInputElement).checked)" /><i class="tw:relative tw:w-28 tw:h-16 tw:rounded-[8px] tw:bg-panel-3 tw:[transition:background_0.15s] tw:[.sw_input:checked+&]:bg-accent tw:after:content-[''] tw:after:absolute tw:after:top-2 tw:after:left-2 tw:after:w-12 tw:after:h-12 tw:after:rounded-[50%] tw:after:bg-text-2 tw:after:[transition:transform_0.15s] tw:[.sw_input:checked+&]:after:[transform:translateX(12px)] tw:[.sw_input:checked+&]:after:bg-white"></i>Сохранять историю</label>
      <label class="search tw:inline-flex tw:items-center tw:gap-6 tw:w-[min(320px,40%)] tw:h-28 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:text-muted"><Icon name="search" :size="13" /><input class="tw:flex-1 tw:min-w-0 tw:h-26 tw:p-0 tw:border-0 tw:bg-transparent" v-model="q" spellcheck="false" placeholder="Поиск по скопированному" /></label>
      <span class="grow tw:flex-1"></span>
      <span class="muted tw:text-muted tw:text-[12px]">{{ q ? `${shown.length} из ${state.items.length}` : `${state.items.length} из 1000` }}</span>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Очистить историю" :disabled="!state.items.length" @click="clearAll"><Icon name="trash" :size="14" /></button>
    </div>
    <div class="list tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-0 tw:pr-14 tw:pb-14 tw:pl-14">
      <template v-for="g in groups" :key="g.k">
        <div class="day tw:sticky tw:top-0 tw:z-1 tw:pt-12 tw:pr-0 tw:pb-6 tw:pl-0 tw:bg-bg tw:text-text-hi tw:text-[12.5px] tw:font-semibold tw:first-letter:uppercase">{{ g.name }}</div>
        <div v-for="x in g.items" :key="x.id" class="it tw:group/it tw:relative tw:grid tw:grid-cols-[46px_minmax(0,1fr)_auto] tw:gap-10 tw:items-start tw:py-7 tw:px-8 tw:rounded-r2 tw:cursor-pointer tw:hover:not-[&.done]:bg-hover tw:[&.done]:bg-up/8" :class="{ done: copied === x.id }" title="Клик — скопировать снова" @click="copy(x)">
          <span class="tm tw:pt-1 tw:text-muted tw:font-data tw:text-[11.5px]">{{ hm(x.at) }}</span>
          <pre class="tx tw:m-0 tw:overflow-hidden tw:text-text tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:whitespace-pre-wrap tw:[word-break:break-word] tw:[&.clip]:max-h-[6em] tw:[&.clip]:[-webkit-mask-image:linear-gradient(#000_60%,transparent)] tw:[&.clip]:mask-[linear-gradient(#000_60%,transparent)]" :class="{ clip: long(x.text) && !open.has(x.id) }">{{ x.text }}</pre>
          <span class="acts tw:flex tw:items-center tw:gap-2" @click.stop>
            <b v-if="x.count > 1" class="cnt tw:py-0 tw:px-6 tw:text-muted tw:font-data tw:text-[11px] tw:font-medium" :title="`Копировали ${x.count} раз`">×{{ x.count }}</b>
            <button v-if="long(x.text)" class="ib sm tw:inline-flex tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:w-22 tw:h-22 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:opacity-0 tw:group-hover/it:opacity-100 tw:hover:enabled:border-border-3" :title="open.has(x.id) ? 'Свернуть' : 'Показать целиком'" @click="toggle(x.id)"><Icon name="chevronDown" :size="12" :style="open.has(x.id) ? 'transform: rotate(180deg)' : ''" /></button>
            <button class="ib sm tw:inline-flex tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:w-22 tw:h-22 tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:opacity-0 tw:group-hover/it:opacity-100 tw:hover:enabled:border-border-3" title="Удалить" @click="window_remove(x.id)"><Icon name="x" :size="12" /></button>
          </span>
          <span v-if="copied === x.id" class="ok tw:absolute tw:right-70 tw:top-7 tw:text-up-fg tw:text-[11.5px]">Скопировано</span>
        </div>
      </template>
      <p v-if="!state.items.length" class="empty tw:my-20 tw:mx-0 tw:text-muted tw:text-[13px]">
        {{ state.on ? 'Пока пусто. Всё, что вы скопируете (Ctrl+C) в любой программе, появится здесь.' : 'История выключена — включите «Сохранять историю».' }}
      </p>
      <p v-else-if="!shown.length" class="empty tw:my-20 tw:mx-0 tw:text-muted tw:text-[13px]">Ничего не нашлось</p>
      <p class="foot tw:mt-16 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-dim tw:text-[11.5px]">Только текст. Хранятся последние 1000 записей, зашифрованно, только на этом компьютере. То, что менеджеры паролей помечают как «не сохранять в истории», не сохраняется.</p>
    </div>
  </div>
</template>

<script lang="ts">
const window_remove = (id: string) => void window.qa.clipRemove(id)
</script>
