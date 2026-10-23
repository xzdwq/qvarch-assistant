<script setup lang="ts">
/** The open request: name, method and address, its tabs (params, headers, auth, body, before, after), the answer. */
import { computed } from 'vue'
import { buildUrl, findNode, HTTP_METHODS, type HttpRequest } from '@shared/http'
import { methodColor as mColor, REQUEST_TABS as TABS, requestTabCount as count } from '@shared/httpCollection'
import Icon from '../../components/Icon.vue'
import KvEditor from '../../components/KvEditor.vue'
import { backTo } from '../../lib/httpRuns'
import HttpAuthTab from './HttpAuthTab.vue'
import HttpBodyTab from './HttpBodyTab.vue'
import HttpCopyMenu from './HttpCopyMenu.vue'
import HttpPostTab from './HttpPostTab.vue'
import HttpPreTab from './HttpPreTab.vue'
import HttpResponse from './HttpResponse.vue'
import { useHttpView } from './httpViewContext'

const props = defineProps<{ req: HttpRequest }>()
const { collection, runner, side, tab } = useHttpView()
const { doc, sel, varMap } = collection
const { running, run, abortSingle } = runner
const { sideHidden } = side
const fullUrl = computed(() => buildUrl(props.req, varMap.value))
/** Opened from a chain: the way back to it (backTo — kept apart, the section may be left and opened again). */
const backName = computed(() => {
  const n = backTo.value ? findNode(doc.items, backTo.value) : undefined
  return n?.type === 'folder' ? n.name : undefined
})
</script>

<template>
    <section class="main tw:flex tw:flex-col tw:min-h-0 tw:min-w-0 tw:pt-10 tw:pr-14 tw:pb-12 tw:pl-14 tw:gap-8">
      <div class="line tw:flex tw:items-center tw:gap-8">
        <button v-if="sideHidden" class="sshow tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Показать панель запросов" @click="sideHidden = false"><Icon name="sidebar" :size="14" /></button>
        <button v-if="backName" class="back tw:flex-none tw:inline-flex tw:items-center tw:gap-4 tw:max-w-260 tw:h-28 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-6 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-[12.5px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" :title="`Вернуться к цепочке «${backName}»`" @click="(sel = backTo), (backTo = undefined)"><Icon name="chevronLeft" :size="14" />{{ backName }}</button>
        <input v-model="req.name" class="rname tw:min-w-200 tw:max-w-520 tw:flex-1 tw:h-28 tw:py-0 tw:px-6 tw:border-transparent tw:bg-transparent tw:text-[14px] tw:font-semibold tw:text-text-hi tw:hover:border-border-2" spellcheck="false" title="Название запроса" />
        <span class="grow tw:flex-1"></span>
        <HttpCopyMenu :req="req" />
      </div>
      <div class="send tw:flex tw:gap-6">
        <select v-model="req.method" class="method tw:flex-none tw:w-104 tw:font-data tw:font-bold" :style="{ color: mColor(req.method) }">
          <option v-for="m in HTTP_METHODS" :key="m" :value="m" :style="{ color: mColor(m) }">{{ m }}</option>
        </select>
        <input v-model="req.url" class="url tw:flex-1 tw:min-w-0 tw:font-data tw:text-[13px]" placeholder="https://… · {{переменная}}" spellcheck="false" @keydown.enter.prevent="run" />
        <button v-if="!running" class="primary go tw:flex-none tw:min-w-110 tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:border-accent-hi" title="Отправить (Ctrl+Enter)" @click="run">Отправить</button>
        <button v-else class="abort go tw:inline-flex tw:items-center tw:justify-center tw:gap-6 tw:border-down tw:bg-down/16 tw:text-down-fg tw:flex-none tw:min-w-110 tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Прервать запрос" @click="abortSingle"><Icon name="stop" :size="12" />Прервать</button>
      </div>
      <div v-if="fullUrl && fullUrl !== req.url" class="full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:font-data tw:text-[11.5px]" :title="fullUrl">→ {{ fullUrl }}</div>

      <div class="tabs tw:flex tw:gap-0 tw:border-b tw:border-b-border">
        <button class="tw:relative tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:[&.on]:text-accent-fg tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-8 tw:[&.on]:after:right-8 tw:[&.on]:after:-bottom-1 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}<i class="tw:py-0 tw:px-5 tw:rounded-r1 tw:bg-panel-3 tw:text-text-2 tw:not-italic tw:font-data tw:text-[10px]" v-if="count(req, t.id)">{{ count(req, t.id) }}</i></button>
      </div>
      <div class="pane tw:flex-[1_1_45%] tw:min-h-0 tw:overflow-y-auto tw:py-2 tw:px-0">
        <KvEditor v-if="tab === 'params'" :rows="req.params" key-hint="параметр" />
        <KvEditor v-else-if="tab === 'headers'" :rows="req.headers" key-hint="заголовок (Content-Type, X-…)" />
        <HttpAuthTab v-else-if="tab === 'auth'" :req="req" />
        <HttpBodyTab v-else-if="tab === 'body'" :req="req" />
        <HttpPreTab v-else-if="tab === 'pre'" :req="req" />
        <HttpPostTab v-else :req="req" />
      </div>

      <!-- the answer -->
      <HttpResponse :req="req" />
    </section>
</template>
