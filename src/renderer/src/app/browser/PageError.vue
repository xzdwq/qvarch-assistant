<script setup lang="ts">
import { computed } from 'vue'
import { exitCodeText, goneReasonText, PAGE_GONE_TEXT } from '@shared/browser'
import Icon from '../../components/Icon.vue'
import type { BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/**
 * The page did not open: why, again; a site's own certificate — opened anyway if trusted. Its process gone or not
 * answering: said so, «Перезапустить» starts it again at the same address.
 */
const props = defineProps<{ p: BPane }>()
const view = useBrowserView()
const { byId } = view.tabs
const { nav, trust } = view.site
const err = computed(() => byId(props.p.active)!.error!)
const gone = computed(() => (err.value.gone ? PAGE_GONE_TEXT[err.value.gone] : undefined))
/** Its process ended: why (Chromium's reason) and its exit code, as read. */
const crash = computed(() => {
  if (err.value.gone !== 'crashed') return undefined
  const code = exitCodeText(err.value.code)
  return { why: goneReasonText(err.value.desc), detail: code ? `${err.value.desc} · ${code}` : err.value.desc }
})
</script>

<template>
  <div class="perr tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:h-full tw:p-24 tw:text-center">
    <Icon name="globe" :size="28" />
    <b class="tw:text-text-hi tw:text-[16px]">{{ gone ? gone.title : err.cert ? 'Сертификат сайта не доверенный' : 'Страница не открылась' }}</b>
    <span class="muted tw:text-muted">{{ err.url }}</span>
    <p v-if="crash" class="tw:max-w-520 tw:text-text">{{ crash.why }}</p>
    <code v-if="crash" class="tw:text-down-fg tw:font-data">{{ crash.detail }}</code>
    <p v-if="gone" class="muted tw:max-w-520 tw:text-muted">{{ gone.hint }}</p>
    <code v-else class="tw:text-down-fg tw:font-data">{{ err.desc }} ({{ err.code }})</code>
    <p v-if="err.cert" class="muted tw:max-w-520 tw:text-muted">Так бывает у внутренних сайтов с собственным сертификатом. Если вы доверяете сайту <b class="tw:text-text-hi tw:text-[16px]">{{ err.host }}</b>, его можно открыть — до выхода из Qvarch.</p>
    <div class="erow tw:flex tw:gap-8">
      <button class="primary" @click="p.active && nav(p.active, 'reload')">{{ gone ? 'Перезапустить' : 'Повторить' }}</button>
      <button v-if="err.cert" @click="p.active && trust(p.active, err.host!)">Открыть всё равно</button>
    </div>
  </div>
</template>

<style scoped src="./PageError.css"></style>
