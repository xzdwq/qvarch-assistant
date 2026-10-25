<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { HELP, HELP_GROUPS } from '../lib/helpContent'
import Icon from './Icon.vue'

/** «Инструкция»: the notebook's and the testing tools' help — sections on the left, the section on the right, a search. */
const emit = defineEmits<{ close: [] }>()
const q = ref('')
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').toLowerCase()
const shown = computed(() => {
  const w = q.value.trim().toLowerCase()
  return w ? HELP.filter((s) => `${s.title} ${textOf(s.html)}`.toLowerCase().includes(w)) : HELP
})
const cur = ref(HELP[0].id)
const sec = computed(() => shown.value.find((s) => s.id === cur.value) ?? shown.value[0])
const body = ref<HTMLElement>()
function pick(id: string): void {
  cur.value = id
  void nextTick(() => body.value?.scrollTo({ top: 0 }))
}
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="hl-back tw:fixed tw:inset-0 tw:z-1800 tw:grid tw:place-items-center tw:bg-black/45" @mousedown.self="emit('close')">
      <div class="hl tw:flex tw:w-[min(980px,calc(100vw-32px))] tw:h-[min(720px,calc(100vh-48px))] tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:shadow-pop tw:overflow-hidden" role="dialog" aria-label="Инструкция">
        <nav class="tw:flex tw:flex-[0_0_230px] tw:flex-col tw:gap-1 tw:py-10 tw:px-8 tw:border-r tw:border-r-border tw:overflow-y-auto">
          <label class="hl-q tw:flex tw:items-center tw:gap-6 tw:mb-6 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[5px] tw:bg-field tw:text-muted"><Icon name="search" :size="12" /><input class="tw:flex-1 tw:min-w-0 tw:h-28 tw:border-0 tw:bg-transparent tw:text-text tw:[font:inherit]" v-model="q" placeholder="Поиск по инструкции" spellcheck="false" /></label>
          <template v-for="g in HELP_GROUPS" :key="g">
            <p v-if="shown.some((s) => s.group === g)" class="hl-g tw:mt-10 tw:mr-8 tw:mb-4 tw:ml-8 tw:text-muted tw:text-[11px] tw:font-semibold tw:tracking-[0.04em] tw:uppercase">{{ g }}</p>
            <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:text-left tw:whitespace-nowrap tw:hover:not-[&.on]:bg-hover tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/16 tw:[&.on]:text-text tw:hover:enabled:border-border-3" v-for="s in shown.filter((x) => x.group === g)" :key="s.id" :class="{ on: sec?.id === s.id }" @click="pick(s.id)"><Icon :name="s.icon" :size="13" /><span class="tw:overflow-hidden tw:text-ellipsis">{{ s.title }}</span></button>
          </template>
          <p v-if="!shown.length" class="hl-none tw:m-8 tw:text-muted">Ничего не найдено</p>
        </nav>
        <section class="tw:flex-1 tw:min-w-0 tw:overflow-y-auto" ref="body">
          <header class="tw:sticky tw:top-0 tw:flex tw:items-center tw:pt-14 tw:pr-20 tw:pb-8 tw:pl-20 tw:bg-panel">
            <h2 class="tw:m-0 tw:text-[18px]" v-if="sec">{{ sec.title }}</h2>
            <span class="grow tw:flex-1"></span>
            <button class="hl-x tw:grid tw:place-items-center tw:w-28 tw:h-28 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:bg-hover tw:hover:enabled:border-border-3" title="Закрыть (Esc)" @click="emit('close')"><Icon name="x" :size="14" /></button>
          </header>
          <!-- (the help's own static text — no one else's) -->
          <div v-if="sec" class="hl-body tw:pt-0 tw:pr-20 tw:pb-24 tw:pl-20 tw:text-text tw:text-[13.5px] tw:leading-[1.55]" v-html="sec.html"></div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="./NotebookHelp.css"></style>
