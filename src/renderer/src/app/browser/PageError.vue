<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import type { BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/** The page did not open: why, again; a site's own certificate — opened anyway if trusted. */
defineProps<{ p: BPane }>()
const view = useBrowserView()
const { byId } = view.tabs
const { nav, trust } = view.site
</script>

<template>
  <div class="perr tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:h-full tw:p-24 tw:text-center">
    <Icon name="globe" :size="28" />
    <b class="tw:text-text-hi tw:text-[16px]">{{ byId(p.active)!.error!.cert ? 'Сертификат сайта не доверенный' : 'Страница не открылась' }}</b>
    <span class="muted tw:text-muted">{{ byId(p.active)!.error!.url }}</span>
    <code class="tw:text-down-fg tw:font-data">{{ byId(p.active)!.error!.desc }} ({{ byId(p.active)!.error!.code }})</code>
    <p v-if="byId(p.active)!.error!.cert" class="muted tw:max-w-520 tw:text-muted">Так бывает у внутренних сайтов с собственным сертификатом. Если вы доверяете сайту <b class="tw:text-text-hi tw:text-[16px]">{{ byId(p.active)!.error!.host }}</b>, его можно открыть — до выхода из Qvarch.</p>
    <div class="erow tw:flex tw:gap-8">
      <button class="primary" @click="p.active && nav(p.active, 'reload')">Повторить</button>
      <button v-if="byId(p.active)!.error!.cert" @click="p.active && trust(p.active, byId(p.active)!.error!.host!)">Открыть всё равно</button>
    </div>
  </div>
</template>

<style scoped src="./PageError.css"></style>
