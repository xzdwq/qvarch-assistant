<script setup lang="ts">
/** A folder: its requests as a chain run in order (in the main process), where to stop, each step's outcome. */
import { DEFAULT_STOP_ON, type HttpFolder } from '@shared/http'
import { methodColor as mColor, methodShort as short, statusClass as statusCls } from '@shared/httpCollection'
import Icon from '../../components/Icon.vue'
import StopOnPicker from '../../components/StopOnPicker.vue'
import { abortChain, backTo } from '../../lib/httpRuns'
import { useHttpView } from './httpViewContext'

defineProps<{ folder: HttpFolder }>()
const { collection, runner, side } = useHttpView()
const { sel } = collection
const { folderReqs, myChain, chainBusy, runFolder, stepState } = runner
const { sideHidden } = side
/** A step opened (the way back to the chain remembered). */
function openStep(id: string): void {
  backTo.value = sel.value
  sel.value = id
}
</script>

<template>
    <section class="main fold tw:flex tw:flex-col tw:min-h-0 tw:min-w-0 tw:pt-10 tw:pr-14 tw:pb-12 tw:pl-14 tw:gap-8">
      <div class="line tw:flex tw:items-center tw:gap-8">
        <button v-if="sideHidden" class="sshow tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Показать панель запросов" @click="sideHidden = false"><Icon name="sidebar" :size="14" /></button>
        <Icon name="folderOpen" :size="16" class="fi tw:text-warn tw:[&&]:flex-none" />
        <input v-model="folder.name" class="rname tw:min-w-200 tw:max-w-520 tw:flex-1 tw:h-28 tw:py-0 tw:px-6 tw:border-transparent tw:bg-transparent tw:text-[14px] tw:font-semibold tw:text-text-hi tw:hover:border-border-2" spellcheck="false" title="Название папки" />
      </div>
      <div class="frun tw:flex tw:items-center tw:gap-12 tw:mt-6">
        <button v-if="!myChain?.running" class="primary go tw:flex-none tw:min-w-110 tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:border-accent-hi" :disabled="chainBusy || !folderReqs.length" :title="chainBusy ? 'Уже выполняется другая цепочка' : 'Выполнить все запросы папки сверху вниз (Ctrl+Enter)'" @click="runFolder">▶ Запустить по порядку</button>
        <button v-else class="abort tw:inline-flex tw:items-center tw:justify-center tw:gap-6 tw:border-down tw:bg-down/16 tw:text-down-fg tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Прервать: текущий запрос обрывается, следующие не выполняются" @click="abortChain"><Icon name="stop" :size="12" />Прервать</button>
        <StopOnPicker :model-value="folder.stopOn ?? DEFAULT_STOP_ON" @update:model-value="(v) => folder && (folder.stopOn = v)" />
        <span v-if="myChain" class="cstate tw:text-text-2 tw:text-[12.5px] tw:[&.bad]:text-down-fg" :class="{ bad: myChain.stopped }">
          <template v-if="myChain.running">Выполняется {{ myChain.done + 1 }} из {{ myChain.ids.length }}…</template>
          <template v-else-if="myChain.stopped">{{ myChain.stopped }}</template>
          <template v-else>Готово: {{ myChain.done }} из {{ myChain.ids.length }}</template>
        </span>
      </div>
      <div class="chain tw:flex tw:flex-col tw:mt-12 tw:border tw:border-border tw:rounded-r2 tw:overflow-auto">
        <div
          v-for="(x, i) in folderReqs"
          :key="x.req.id"
          class="cr tw:flex tw:items-center tw:gap-10 tw:min-h-34 tw:py-0 tw:px-12 tw:border-b tw:border-b-border tw:text-[12.5px] tw:cursor-default tw:last:border-b-0 tw:hover:not-[&.now]:bg-hover tw:[&.now]:bg-accent/12 tw:[&.bad]:[box-shadow:inset_3px_0_0_var(--down)]"
          :class="{ now: myChain?.running && myChain.ids[myChain.done] === x.req.id, bad: stepState(x.req.id)?.error || (stepState(x.req.id)?.status ?? 0) >= 400 }"
          title="Открыть запрос (вернуться к цепочке — стрелкой «назад»)"
          @click="openStep(x.req.id)"
        >
          <span class="cn tw:w-22 tw:text-muted tw:font-data tw:text-[11px] tw:text-right">{{ i + 1 }}</span>
          <b class="mt tw:flex-none tw:w-34 tw:font-data tw:text-[9.5px] tw:font-bold" :style="{ color: mColor(x.req.method) }">{{ short(x.req.method) }}</b>
          <span class="cnm tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-data">{{ [...x.path, x.req.name].join(' / ') }}</span>
          <span v-if="myChain?.running && myChain.ids[myChain.done] === x.req.id" class="cspin tw:w-12 tw:h-12 tw:border-2 tw:border-border-2 tw:[&&]:border-t-accent tw:rounded-[50%] tw:animate-[HttpView-hv-spin_0.8s_linear_infinite]"></span>
          <template v-else-if="stepState(x.req.id)">
            <b v-if="stepState(x.req.id)!.status" class="st tw:[&.none]:m-12 tw:[&.none]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-muted tw:[&.url]:flex-1 tw:[&.url]:min-w-0 tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.post]:not-[&.log]:flex tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.post]:not-[&.log]:flex-col tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.post]:not-[&.log]:gap-8 tw:py-1 tw:px-7 tw:rounded-r2 tw:font-data tw:text-[11.5px] tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:bg-up/15 tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-up-fg tw:[&.s3]:not-[&.e4]:not-[&.e5]:bg-info/15 tw:[&.s3]:not-[&.e4]:not-[&.e5]:text-info-fg tw:[&.e4]:not-[&.e5]:bg-warn/16 tw:[&.e4]:not-[&.e5]:text-warn-fg tw:[&.e5]:bg-down/16 tw:[&.e5]:text-down-fg tw:[&.log]:flex tw:[&.log]:flex-col tw:[&.log]:gap-2 tw:[&.log]:font-data tw:[&.log]:text-[12px]" :class="statusCls(stepState(x.req.id)!.status!)">{{ stepState(x.req.id)!.status }}</b>
            <span v-if="stepState(x.req.id)!.time" class="muted">{{ stepState(x.req.id)!.time }} мс</span>
            <span v-if="stepState(x.req.id)!.error" class="rerr tw:max-w-[40%] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:min-w-0 tw:text-down-fg tw:text-[12px]" :title="stepState(x.req.id)!.error">{{ stepState(x.req.id)!.error }}</span>
          </template>
        </div>
        <p v-if="!folderReqs.length" class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">В папке нет запросов</p>
      </div>
    </section>
</template>
