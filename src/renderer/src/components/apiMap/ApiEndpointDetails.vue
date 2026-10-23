<script setup lang="ts">
import { avgMs, fieldLine, statusLine, type ApiEndpoint, type ApiSample, type Shape } from '@shared/apiMap'
import { httpRequestText } from '@shared/httpBlock'
import Icon from '../Icon.vue'
import { ago, exampleOf, ms } from './apiMapFormat'

/**
 * One endpoint of «Карта API» opened: its answers, time, when, parameters, pages; then what it answers, what it is
 * sent, its headers, an example of a call (to copy as a request).
 */
defineProps<{
  e: ApiEndpoint
  /** Its Swagger operation's summary (when the site's Swagger has it). */
  summary?: string
  /** What was just copied (its key) — its button says so. */
  copied: string
}>()
const emit = defineEmits<{ copy: [text: string, what: string]; copyOne: [] }>()
/** The view of the opened endpoint — kept when another one is opened. */
const tab = defineModel<'res' | 'req' | 'hd' | 'ex'>('tab', { required: true })
/** The calls kept (the last good one, the last failed one) — their headers, their example. */
const samplesOf = (e: ApiEndpoint) => [e.sample, e.errSample].filter((s): s is ApiSample => !!s)
const rowsOf = (sh: Shape) => Object.entries(sh.fields).map(([p, f]) => ({ p, ...fieldLine(f, sh.bodies), ex: f.ex }))
const depth = (p: string) => (p.match(/\.|\[\]/g) ?? []).length
const asHttp = (e: ApiEndpoint) => (exampleOf(e) ? httpRequestText(exampleOf(e)!) : '')
</script>

<template>
  <div class="am-more tw:flex tw:flex-col tw:gap-8 tw:pt-4 tw:pr-6 tw:pb-10 tw:pl-10">
    <p v-if="summary" class="am-sum tw:m-0 tw:text-text-2">{{ summary }}</p>
    <dl class="tw:grid tw:grid-cols-[auto_1fr] tw:gap-y-3 tw:gap-x-10 tw:m-0">
      <dt class="tw:text-muted">Ответы</dt>
      <dd class="tw:flex tw:flex-wrap tw:gap-4 tw:m-0 tw:min-w-0">{{ statusLine(e).replace(/\b0×/, 'сбой×') }}</dd>
      <dt class="tw:text-muted">Время</dt>
      <dd class="tw:flex tw:flex-wrap tw:gap-4 tw:m-0 tw:min-w-0">среднее {{ ms(avgMs(e)) }}, макс. {{ ms(e.msMax) }}</dd>
      <dt class="tw:text-muted">Когда</dt>
      <dd class="tw:flex tw:flex-wrap tw:gap-4 tw:m-0 tw:min-w-0">{{ ago(e.first) }} — {{ ago(e.last) }}</dd>
      <template v-if="e.query.length"><dt class="tw:text-muted">Параметры</dt><dd class="tw:flex tw:flex-wrap tw:gap-4 tw:m-0 tw:min-w-0"><code class="tw:font-data tw:text-[11.5px] tw:py-0 tw:px-4 tw:rounded-[3px] tw:bg-panel-3 tw:wrap-anywhere" v-for="k in e.query" :key="k">{{ k }}</code></dd></template>
      <template v-if="Object.keys(e.pages).length"><dt class="tw:text-muted">Страницы</dt><dd class="tw:flex tw:flex-wrap tw:gap-4 tw:m-0 tw:min-w-0"><code class="tw:font-data tw:text-[11.5px] tw:py-0 tw:px-4 tw:rounded-[3px] tw:bg-panel-3 tw:wrap-anywhere" v-for="(n, p) in e.pages" :key="p" :title="`${n} раз`">{{ p }}</code></dd></template>
    </dl>
    <div class="seg tw:inline-flex tw:self-start tw:border tw:border-border tw:rounded-[5px] tw:overflow-hidden">
      <button class="tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:bg-accent/16 tw:[&.on]:text-text" :class="{ on: tab === 'res' }" @click="tab = 'res'">Приходит <b class="tw:font-medium tw:text-muted">{{ Object.keys(e.res.fields).length }}</b></button>
      <button class="tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:bg-accent/16 tw:[&.on]:text-text" :class="{ on: tab === 'req' }" @click="tab = 'req'">Отправляется <b class="tw:font-medium tw:text-muted">{{ Object.keys(e.req.fields).length }}</b></button>
      <button class="tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:bg-accent/16 tw:[&.on]:text-text" :class="{ on: tab === 'hd' }" title="Заголовки запроса и ответа (секреты скрыты)" @click="tab = 'hd'">Заголовки</button>
      <button class="tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:[&.on]:bg-accent/16 tw:[&.on]:text-text" :class="{ on: tab === 'ex' }" @click="tab = 'ex'">Пример</button>
    </div>
    <template v-if="tab === 'hd'">
      <p v-if="!samplesOf(e).some((s) => s.reqHeaders || s.resHeaders)" class="muted tw:text-muted">Заголовков пока нет — они сохраняются у новых вызовов.</p>
      <template v-for="s in samplesOf(e)" v-else :key="s.at">
        <p class="am-sh tw:flex tw:gap-8 tw:m-0">
          <b class="tw:text-up-fg tw:[&.bad]:text-down-fg" :class="{ bad: s.status === 0 || s.status >= 400 }">{{ s.status === 0 ? 'сбой' : s.status }}</b><span class="muted tw:text-muted">{{ ago(s.at) }}</span>
        </p>
        <template v-for="part in [{ t: 'Запрос', h: s.reqHeaders }, { t: 'Ответ', h: s.resHeaders }]" :key="part.t">
          <table v-if="part.h" class="am-f am-h tw:w-full tw:border-collapse tw:table-fixed tw:mb-6 tw:select-text">
            <!-- (the columns' widths set here — a fixed table takes them from its first row, the heading over all three) -->
            <colgroup><col class="hk tw:w-[34%]" /><col /><col class="hb tw:w-28" /></colgroup>
            <thead>
              <tr><th class="tw:py-2 tw:px-6 tw:border-b tw:border-b-border-2 tw:text-text-2 tw:font-semibold tw:text-left tw:whitespace-nowrap" colspan="3">{{ part.t }} <span class="muted tw:text-muted">{{ part.h.length }}</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="[k, v] in part.h" :key="k">
                <td class="tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-auto"><code class="tw:font-data tw:text-[11.5px]">{{ k }}</code></td>
                <td class="ex tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-auto tw:text-muted tw:font-data tw:text-[11px]" :title="v">{{ v }}</td>
                <td class="cp tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-auto tw:py-0 tw:px-2 tw:text-right"><button class="hc tw:inline-grid tw:place-items-center tw:w-22 tw:h-20 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" :title="copied === `h:${s.at}:${part.t}:${k}` ? 'Скопировано' : 'Копировать значение'" @click="emit('copy', v, `h:${s.at}:${part.t}:${k}`)"><Icon :name="copied === `h:${s.at}:${part.t}:${k}` ? 'check' : 'copy'" :size="12" /></button></td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </template>
    <template v-else-if="tab !== 'ex'">
      <p v-if="!rowsOf(tab === 'res' ? e.res : e.req).length" class="muted tw:text-muted">{{ tab === 'res' ? 'Ответы с JSON пока не попадались.' : 'Тела запроса нет (или не JSON).' }}</p>
      <table v-else class="am-f tw:w-full tw:border-collapse tw:table-fixed">
        <tbody>
          <tr v-for="r in rowsOf(tab === 'res' ? e.res : e.req)" :key="r.p">
            <td class="tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-[34%]" :style="{ paddingLeft: `${6 + depth(r.p) * 10}px` }"><code class="tw:font-data tw:text-[11.5px]">{{ r.p.split(/\.(?![^[]*\])/).pop() }}</code></td>
            <td class="ty tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-[34%] tw:w-[30%] tw:text-text-2">{{ r.type }}</td>
            <td class="of tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-[34%] tw:w-62 tw:text-muted" :title="r.often === 'всегда' ? 'В каждом теле' : 'В скольких телах было'">{{ r.often }}</td>
            <td class="ex tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:align-top tw:first:w-[34%] tw:text-muted tw:font-data tw:text-[11px]" :title="r.ex">{{ r.ex }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted tw:text-muted">Тел просмотрено: {{ (tab === 'res' ? e.res : e.req).bodies }}</p>
    </template>
    <template v-else>
      <template v-for="s in [e.sample, e.errSample].filter(Boolean)" :key="s!.at">
        <p class="am-sh tw:flex tw:gap-8 tw:m-0">
          <b class="tw:text-up-fg tw:[&.bad]:text-down-fg" :class="{ bad: s!.status === 0 || s!.status >= 400 }">{{ s!.status === 0 ? 'сбой' : s!.status }}</b><span class="muted tw:text-muted">{{ ago(s!.at) }}</span>
        </p>
        <pre class="am-pre tw:max-h-220 tw:m-0 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[5px] tw:bg-bg tw:overflow-auto tw:font-data tw:text-[11.5px] tw:whitespace-pre-wrap tw:break-all">{{ e.method }} {{ s!.url }}{{ s!.reqBody ? `\n\n${s!.reqBody}` : '' }}</pre>
        <pre v-if="s!.resBody" class="am-pre res tw:max-h-220 tw:m-0 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-[5px] tw:bg-bg tw:overflow-auto tw:font-data tw:text-[11.5px] tw:whitespace-pre-wrap tw:break-all tw:text-text-2">{{ s!.resBody }}</pre>
      </template>
      <div class="am-acts">
        <button class="tw:[.am-seg_button+&]:border-l tw:[.am-seg_button+&]:border-l-border-2 tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-10" :disabled="!asHttp(e)" title="Запрос текстом — вставьте в блок HTTP заметки и выполните" @click="emit('copyOne')"><Icon name="copy" :size="12" />{{ copied === e.key ? 'Скопировано' : 'Копировать запрос' }}</button>
      </div>
    </template>
  </div>
</template>
