<script setup lang="ts">
import { isBoard } from '@shared/whiteboard'
import { reasonText } from '@shared/notebook/graph'
import { META_PLACE } from '@shared/agent/docAiSearch'
import { openFile } from '@nb/workspace/paneLayout'
import { setDocAiOpen } from './docai/docAiOpen'
import Icon from '@renderer/components/Icon.vue'
import { useNotebookScreen } from './notebookScreen'

/** Search through all notes in the side: the query, the notes found with their matching lines (the match marked). */
const { q, hits, searching, setSearchInput, toggleSearch, openHit } = useNotebookScreen().search
/** A line cut around its match: before, the match, after. */
const parts = (s: string, at: number, len: number) => ({ a: s.slice(0, at), m: s.slice(at, at + len), b: s.slice(at + len) })
/** A note found in its metadata: opened, its «Метаданные» shown. */
function openMeta(path: string): void {
  openFile(path)
  setDocAiOpen(path, true)
}
</script>

<template>
  <div class="nsearch tw:flex-1 tw:min-h-0 tw:flex tw:flex-col">
    <div class="sbox tw:flex tw:items-center tw:gap-6 tw:mt-0 tw:mr-8 tw:mb-6 tw:ml-8 tw:py-0 tw:px-8 tw:rounded-[4px] tw:border tw:border-border tw:bg-bg tw:text-muted tw:focus-within:border-accent">
      <Icon name="search" :size="13" />
      <input class="tw:flex-1 tw:min-w-0 tw:py-7 tw:px-0 tw:border-0 tw:bg-transparent tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:outline-none" :ref="setSearchInput" v-model="q" placeholder="Искать в заметках · #тег · таблица · /путь" spellcheck="false" @keydown.esc="toggleSearch(false)" />
      <button v-if="q" class="sx tw:inline-flex tw:p-2 tw:border-0 tw:[background:none] tw:text-muted tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Очистить" @click="q = ''"><Icon name="x" :size="12" /></button>
    </div>
    <div class="sres tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:pt-0 tw:pr-6 tw:pb-20 tw:pl-6">
      <p v-if="q.trim() && !hits.length && !searching" class="nempty tw:py-12 tw:px-10 tw:text-muted tw:text-[12.5px]">Ничего не найдено</p>
      <div v-for="h in hits" :key="h.path" class="hit tw:mb-6">
        <button class="hname tw:flex tw:items-center tw:gap-6 tw:w-full tw:py-4 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[13px] tw:font-semibold tw:text-left tw:hover:bg-white/6 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :title="h.path" @click="openHit(h)">
          <Icon :name="isBoard(h.path) ? 'presentation' : 'note'" :size="12" /><span class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ h.name }}</span><em class="tw:not-italic tw:text-[11px] tw:font-medium tw:text-muted" v-if="h.count">{{ h.count }}</em>
        </button>
        <!-- found in its metadata too: where (a click — the note with its «Метаданные» open) -->
        <button v-for="(m, i) in h.meta ?? []" :key="`m${i}`" class="tw:flex tw:items-center tw:gap-5 tw:w-full tw:min-w-0 tw:pt-2 tw:pr-6 tw:pb-2 tw:pl-24 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:text-left tw:whitespace-nowrap tw:hover:bg-white/6" :title="`Найдено в метаданных — ${META_PLACE[m.where]}`" @click="openMeta(h.path)">
          <span class="tw:flex-none tw:px-5 tw:rounded-r1 tw:bg-accent/16 tw:text-accent-fg tw:text-[10.5px]">{{ META_PLACE[m.where] }}</span>
          <span class="tw:min-w-0 tw:truncate"><span>{{ parts(m.text, m.at, m.len).a }}</span><mark class="tw:bg-warn/30 tw:text-text-hi tw:rounded-[2px]">{{ parts(m.text, m.at, m.len).m }}</mark><span>{{ parts(m.text, m.at, m.len).b }}</span></span>
        </button>
        <!-- found by its graph too: by what -->
        <div v-if="h.via?.length" class="hvia tw:flex tw:gap-4 tw:min-w-0 tw:pt-1 tw:pr-6 tw:pb-3 tw:pl-24 tw:overflow-hidden tw:whitespace-nowrap" :title="h.via.map(reasonText).join('\n')">
          <span v-for="(x, i) in h.via.slice(0, 3)" :key="i" class="tw:flex-none tw:max-w-160 tw:truncate tw:py-0 tw:px-5 tw:rounded-r2 tw:bg-accent/16 tw:text-accent-fg tw:text-[11px]">{{ reasonText(x) }}</span>
          <span v-if="h.via.length > 3" class="tw:flex-none tw:text-dim tw:text-[11px]">+{{ h.via.length - 3 }}</span>
        </div>
        <button v-for="l in h.lines" :key="l.line" class="hline tw:block tw:w-full tw:pt-3 tw:pr-6 tw:pb-3 tw:pl-24 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:leading-[1.4] tw:text-left tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:hover:bg-white/6 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:justify-center tw:[.zoom_&]:h-20 tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:py-0 tw:[.zoom_&]:px-4 tw:[.zoom_&]:border-0 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" @click="openHit(h, l)">
          <span>{{ parts(l.text, l.at, l.len).a }}</span><mark class="tw:bg-warn/30 tw:text-text-hi tw:rounded-[2px]">{{ parts(l.text, l.at, l.len).m }}</mark><span>{{ parts(l.text, l.at, l.len).b }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
