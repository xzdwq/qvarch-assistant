<script setup lang="ts">
/** What runs before the request: other requests in order (e.g. one that gets a token), then a script. */
import { computed } from 'vue'
import { allRequests, findNode, type HttpRequest } from '@shared/http'
import CodeArea from '../../components/CodeArea.vue'
import Icon from '../../components/Icon.vue'
import { useHttpView } from './httpViewContext'

const props = defineProps<{ req: HttpRequest }>()
const { doc, sel } = useHttpView().collection
/** «{{имя}}» as text (a mustache inside a mustache would close it). */
const VAR = '{{имя}}'
/** The requests that can run before this one. */
const preChoices = computed(() => allRequests(doc.items).filter((x) => x.req.id !== props.req.id && !props.req.pre.requests.includes(x.req.id)))
const preName = (id: string) => {
  const n = findNode(doc.items, id)
  return n?.type === 'request' ? n.name : '(удалён)'
}
/** A request before this one moved up or down. */
function movePre(i: number, d: number): void {
  const list = props.req.pre.requests
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
}
</script>

<template>
        <div class="pre tw:flex tw:flex-col tw:gap-8">
          <div class="cap">Сначала выполнить запросы (по порядку)</div>
          <div v-for="(id, i) in req.pre.requests" :key="id" class="prow tw:flex tw:items-center tw:gap-6 tw:h-28">
            <span class="pn tw:w-18 tw:text-muted tw:font-data tw:text-[11px]">{{ i + 1 }}.</span>
            <button class="pname tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:py-2 tw:px-8 tw:border-0 tw:bg-transparent tw:text-info-fg tw:text-[12.5px] tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" @click="sel = id">{{ preName(id) }}</button>
            <button class="ib tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Выше" :disabled="i === 0" @click="movePre(i, -1)"><Icon name="chevronLeft" :size="12" style="transform: rotate(90deg)" /></button>
            <button class="ib tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Ниже" :disabled="i === req.pre.requests.length - 1" @click="movePre(i, 1)"><Icon name="chevronRight" :size="12" style="transform: rotate(90deg)" /></button>
            <button class="ib tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Убрать" @click="req.pre.requests.splice(i, 1)"><Icon name="x" :size="12" /></button>
          </div>
          <select class="padd tw:self-start tw:min-w-260 tw:h-28 tw:text-[12px]" :value="''" @change="(($event.target as HTMLSelectElement).value && req.pre.requests.push(($event.target as HTMLSelectElement).value)), (($event.target as HTMLSelectElement).value = '')">
            <option value="">+ добавить запрос…</option>
            <option v-for="x in preChoices" :key="x.req.id" :value="x.req.id">{{ [...x.path, x.req.name].join(' / ') }}</option>
          </select>
          <div class="cap mt2 tw:mt-8">Скрипт перед запросом</div>
          <CodeArea :key="`${req.id}-pre`" v-model="req.pre.script" lang="js" :min-height="110" />
          <p class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]"><code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">qa.set('имя', значение)</code> — переменная для <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">{{ VAR }}</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">qa.get('имя')</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">qa.log(…)</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">req</code> — этот запрос (только чтение).</p>
        </div>
</template>
