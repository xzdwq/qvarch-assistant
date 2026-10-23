<script setup lang="ts">
import { METHOD_COLOR } from '@shared/http'
import { linkUseText } from '@shared/browser/recordingView'
import { useBrowserView } from './browserViewContext'

/**
 * The picked requests into the HTTP section (teleported): the folder they make, the server's address and the secrets
 * into variables, the links found (values from answers used later) — each kept or not.
 */
const { transfer, transferPreview, doTransfer } = useBrowserView().recording
const mColor = (m: string) => METHOD_COLOR[m as keyof typeof METHOD_COLOR] ?? 'var(--muted)'
/** «{{base_…}}» as text (a mustache inside a mustache would close it). */
const BASE_VAR = '{{base_…}}'
</script>

<template>
  <div v-if="transfer && transferPreview" class="bq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55" @mousedown.self="transfer = undefined">
    <div class="bq wide tw:flex tw:flex-col tw:gap-10 tw:max-h-[80vh] tw:overflow-auto tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(760px,calc(100vw-32px))]" tabindex="-1" @keydown.esc="transfer = undefined">
      <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">В HTTP: папка «{{ transferPreview.folder.name }}»</div>
      <div class="tlist2 tw:flex tw:flex-col tw:gap-2 tw:max-h-200 tw:overflow-auto tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:font-data tw:text-[12px]">
        <div v-for="r in transferPreview.folder.children" :key="r.id" class="tl2 tw:flex-none tw:flex tw:gap-8 tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis"><b class="tw:flex-none tw:w-52 tw:text-[11px]" :style="{ color: mColor((r as { method: string }).method) }">{{ (r as { method: string }).method }}</b>{{ r.name }}</div>
      </div>
      <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="transfer.base" type="checkbox" />Адрес сервера — в переменную <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px]">{{ BASE_VAR }}</code> (чтобы направить цепочку на другой стенд)</label>
      <label class="tqc tw:flex tw:items-center tw:gap-8 tw:text-text-2 tw:text-[12.5px]"><input v-model="transfer.secrets" type="checkbox" />Токены, куки и ключи — в секретные переменные (хранятся зашифрованными)</label>
      <template v-if="transfer.links.length">
        <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Связи: значения из ответов, которые использованы дальше</div>
        <p class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">Отмеченные будут браться из ответа при каждом запуске, а не повторять записанные. Снимите галочку, если совпадение случайное.</p>
        <div class="links tw:flex tw:flex-col tw:gap-4 tw:max-h-220 tw:overflow-auto">
          <label v-for="l in transfer.links" :key="l.varName" class="lk tw:flex-none tw:flex tw:items-center tw:gap-8 tw:text-[12px] tw:whitespace-nowrap">
            <input v-model="l.on" type="checkbox" />
            <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px]">{{ l.varName }}</code>
            <span class="lv tw:font-data tw:text-[11.5px]" :title="l.value">= {{ l.value.length > 40 ? l.value.slice(0, 40) + '…' : l.value }}</span>
            <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">из ответа №{{ l.from + 1 }} → {{ linkUseText(l) }}</span>
          </label>
        </div>
      </template>
      <p v-else class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">Связей между запросами не найдено — запросы перенесутся с записанными значениями.</p>
      <div class="tqb tw:flex tw:gap-8"><button class="primary" @click="doTransfer">Создать в HTTP ({{ transferPreview.folder.children.length }})</button><button @click="transfer = undefined">Отмена</button></div>
    </div>
  </div>
</template>
