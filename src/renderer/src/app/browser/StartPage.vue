<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { hostOf } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/** A new tab's page: the bookmarks and the most visited pages as tiles. */
const view = useBrowserView()
const { openUrl } = view.tabs
const { flatBms, popular } = view.bookmarks
</script>

<template>
  <div class="start tw:h-full tw:overflow-auto tw:py-40 tw:px-[max(24px,8%)]">
    <div class="st-h tw:flex tw:items-center tw:gap-10 tw:mb-24 tw:text-text-hi tw:text-[20px] tw:font-semibold"><Icon name="globe" :size="22" />Новая вкладка</div>
    <template v-if="flatBms.length">
      <div class="cap tw:mt-18 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Закладки</div>
      <div class="tiles tw:grid tw:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] tw:gap-8">
        <button v-for="b in flatBms" :key="b.id" class="tile tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:grid-rows-[auto_auto] tw:gap-x-8 tw:items-center tw:py-10 tw:px-12 tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:text-left tw:hover:border-accent-line tw:hover:enabled:bg-hover" :title="b.url" @click="openUrl(b.url!)"><Icon name="star" :size="13" /><b class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text tw:font-medium tw:text-[12.5px]">{{ b.title }}</b><span class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11px]">{{ hostOf(b.url!) }}</span></button>
      </div>
    </template>
    <template v-if="popular.length">
      <div class="cap tw:mt-18 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Часто открываете</div>
      <div class="tiles tw:grid tw:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] tw:gap-8">
        <button v-for="h in popular" :key="h.url" class="tile tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:grid-rows-[auto_auto] tw:gap-x-8 tw:items-center tw:py-10 tw:px-12 tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:text-left tw:hover:border-accent-line tw:hover:enabled:bg-hover" :title="h.url" @click="openUrl(h.url)"><Icon name="clock" :size="13" /><b class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text tw:font-medium tw:text-[12.5px]">{{ h.title || hostOf(h.url) }}</b><span class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11px]">{{ hostOf(h.url) }}</span></button>
      </div>
    </template>
    <p v-if="!flatBms.length && !popular.length" class="muted tw:text-muted">Введите адрес сверху (Ctrl+L) — например, localhost:5173 или любимый сайт.</p>
  </div>
</template>

<style scoped src="./StartPage.css"></style>
