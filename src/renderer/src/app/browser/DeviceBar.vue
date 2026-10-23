<script setup lang="ts">
import type { DeviceMode } from '@shared/browser'
import Icon from '../../components/Icon.vue'
import type { BPane } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'

/** The device mode's bar over a pane's page: the device, its size, turned, its density, touch, the scale it is shown at. */
defineProps<{ p: BPane; dv: DeviceMode }>()
const view = useBrowserView()
const { setDevice, sizeDevice, patchDevice, rotateDevice, deviceMenu, dprMenu } = view.device
const { devFits } = view.layout
const numIn = (e: Event) => Number((e.target as HTMLInputElement).value)
</script>

<template>
  <div class="dbar tw:absolute tw:inset-[0_0_auto] tw:z-2 tw:flex tw:items-center tw:gap-4 tw:h-34 tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-8 tw:border-b tw:border-b-border tw:bg-panel tw:whitespace-nowrap tw:overflow-hidden">
    <button class="dpick tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12px] tw:[&:not(.off)]:hover:bg-white/7 tw:hover:enabled:not-[&:not(.off)]:bg-hover tw:hover:enabled:border-border-3" title="Устройство" @click="deviceMenu(p.active, $event)"><span class="dname tw:max-w-160 tw:overflow-hidden tw:text-ellipsis tw:[&&]:@max-[540px]/pg:max-w-90">{{ dv.name || 'Адаптивный' }}</span><Icon name="chevronDown" :size="11" /></button>
    <input class="dnum tw:flex-none tw:w-62 tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-bg tw:text-text tw:font-data tw:text-[12px] tw:text-center tw:[-moz-appearance:textfield] tw:[&::-webkit-inner-spin-button]:[-webkit-appearance:none] tw:[&::-webkit-inner-spin-button]:m-0 tw:[&::-webkit-outer-spin-button]:[-webkit-appearance:none] tw:[&::-webkit-outer-spin-button]:m-0" type="number" min="50" max="4000" :value="dv.w" title="Ширина, CSS px" @change="sizeDevice(p.active, numIn($event), dv.h)" @keydown.enter="($event.target as HTMLInputElement).blur()" />
    <span class="dx tw:text-muted tw:text-[12px]">×</span>
    <input class="dnum tw:flex-none tw:w-62 tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-bg tw:text-text tw:font-data tw:text-[12px] tw:text-center tw:[-moz-appearance:textfield] tw:[&::-webkit-inner-spin-button]:[-webkit-appearance:none] tw:[&::-webkit-inner-spin-button]:m-0 tw:[&::-webkit-outer-spin-button]:[-webkit-appearance:none] tw:[&::-webkit-outer-spin-button]:m-0" type="number" min="50" max="4000" :value="dv.h" title="Высота, CSS px" @change="sizeDevice(p.active, dv.w, numIn($event))" @keydown.enter="($event.target as HTMLInputElement).blur()" />
    <button class="tb rot tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[&&]:@max-[390px]/pg:hidden tw:hover:enabled:border-border-3" title="Повернуть" @click="rotateDevice(p.active)"><Icon name="rotate" :size="13" /></button>
    <span class="dsep tw:@max-[640px]/pg:hidden tw:flex-none tw:w-1 tw:h-18 tw:my-0 tw:mx-4 tw:bg-border"></span>
    <button v-if="dv.mobile" class="dpick dpr tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12px] tw:[&&]:@max-[470px]/pg:hidden tw:[&:not(.off)]:hover:bg-white/7 tw:hover:enabled:not-[&:not(.off)]:bg-hover tw:hover:enabled:border-border-3" title="Плотность пикселей (DPR)" @click="dprMenu(p.active, $event)">DPR {{ dv.dpr }}<Icon name="chevronDown" :size="11" /></button>
    <span v-else class="dpick dpr off tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-[12px] tw:[&&]:@max-[470px]/pg:hidden tw:[&&]:border-dashed tw:text-muted tw:cursor-default tw:[&:not(.off)]:hover:bg-white/7" title="У компьютера плотность пикселей — как у вашего экрана. Своя плотность — у мобильных устройств (включите «Касания»)">DPR экрана</span>
    <button class="dchip tw:group/dchip tw:flex-none tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:text-text tw:[&.on]:border-accent/50 tw:hover:enabled:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: dv.mobile }" :title="dv.mobile ? 'Мобильное устройство: касания вместо мыши, мобильный User-Agent. Клик — как компьютер' : 'Как компьютер. Клик — мобильное: касания и мобильный User-Agent'" @click="patchDevice(p.active, { mobile: !dv.mobile })"><i class="tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-panel-3 tw:group-[.on]/dchip:not-[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white"></i><span class="tw:@max-[540px]/pg:hidden">Касания</span></button>
    <span class="grow tw:flex-1"></span>
    <span v-if="devFits[p.id]" class="dscale tw:@max-[640px]/pg:hidden tw:flex-none tw:py-0 tw:px-6 tw:text-muted tw:font-data tw:text-[11.5px]" :title="devFits[p.id].scale < 1 ? 'Не помещается — показано уменьшенным' : 'В натуральную величину'">{{ Math.round(devFits[p.id].scale * 100) }}%</span>
    <button class="tb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Выключить режим устройства (Ctrl+Shift+M)" @click="setDevice(p.active)"><Icon name="x" :size="13" /></button>
  </div>
</template>

<style scoped src="./DeviceBar.css"></style>
